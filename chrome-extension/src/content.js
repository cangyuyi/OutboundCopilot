/**
 * Outbound Copilot v1.0.0
 * Chrome Extension Content Script - Feishu/Lark Sheet Cell Smart Copy Module
 * 
 * 技术特点：
 * 1. 事件捕获阶段优先处理，零延迟响应点击
 * 2. 特征匹配+DOM向上溯源算法，兼容飞书虚拟滚动动态类名
 * 3. 双策略剪贴板降级方案，适配iframe沙箱权限
 * 4. 防抖+去重机制，避免重复触发
 * 5. 零侵入注入Toast组件，用户反馈即时
 */
(function() {
    'use strict';
    
    // ==================== 配置常量 ====================
    const CONFIG = {
        COOLDOWN_MS: 250,           // 点击防抖冷却时间
        DOM_TRAVERSE_DEPTH: 12,     // DOM向上溯源最大深度（适配飞书多层嵌套）
        TOAST_DURATION: 1500,       // Toast显示时长
        COPY_DELAY_MS: 30,          // 等待飞书原生选中逻辑延迟
        CELL_SELECTORS: [           // 飞书单元格特征匹配（多版本兼容，含知识库嵌入表）
            '.cell-main', '.bitable-cell', '.slick-cell', '.grid-cell',
            '[data-cell-id]', '[data-col-id]', '.cell-value', '.bitable-cell-content',
            '[role="gridcell"]', '[data-record-id]', '[data-field-id]', '[data-cell-key]',
            '.lark-cell', '.cell-wrapper', '.data-cell', '.lark-grid-cell',
            '.bitable-grid-cell', '.sheet-cell', '.table-cell', '.cell-container',
            '.bitable-cell-wrapper', '.lark-table-cell', '[data-row-id]',
            '[class*="cell-"][class*="active"]', '[class*="cell-"][class*="selected"]',
            // 模糊匹配：飞书电子表格(sheets)使用 sheet-cell-xxx / sheet-xxx-cell 类名
            '[class*="sheet-cell"]', '[class*="cell-"][class*="sheet"]',
            '[class*="grid-cell"]', '[class*="bitable-cell"]', '[class*="lark-cell"]',
            // 飞书表格单元格常带 data-row-index / data-col-index 属性
            '[data-row-index]', '[data-col-index]', '[data-cell-index]',
            // 虚拟滚动表格的行内单元格
            '[class*="row-"] > [class*="cell"]', '[class*="row-"] > [class*="col"]'
        ],
        TEXT_SELECTORS: [           // 单元格文本容器优先级
            '.cell-value', '.text-inner', '.content', '[data-text]',
            '.bitable-cell-text', '.cell-text', '.field-value', '.record-value',
            '.lark-cell-text', '.cell-content', '.text-content', '.value',
            '[data-value]', '.cell-display', '.bitable-cell-value', '.render-cell'
        ]
    };

    let lastCopyTime = 0;
    let toastTimer = null;

    // ==================== UI反馈模块 ====================
    /**
     * 注入非侵入式Toast提示
     * @param {string} msg - 显示消息
     * @param {boolean} error - 是否错误提示
     */
    function showToast(msg, error = false) {
        const old = document.getElementById('oc-toast');
        if (old) old.remove();
        if (toastTimer) clearTimeout(toastTimer);

        const t = document.createElement('div');
        t.id = 'oc-toast';
        t.textContent = msg;
        
        const bgColor = error ? 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)' 
                              : 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)';
        
        t.style.cssText = `
            position: fixed; top: 24px; right: 24px; z-index: 2147483647;
            background: ${bgColor}; color: #fff; padding: 12px 24px;
            border-radius: 8px; font-size: 14px; font-weight: 500;
            box-shadow: 0 6px 16px rgba(0,0,0,0.12), 0 3px 6px rgba(0,0,0,0.08);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(8px);
        `;
        const target = document.body || document.documentElement;
        target.appendChild(t);

        // 入场动画
        requestAnimationFrame(() => {
            t.style.transform = 'translateX(0)';
            t.style.opacity = '1';
        });
        t.style.transform = 'translateX(20px)';
        t.style.opacity = '0';

        toastTimer = setTimeout(() => {
            t.style.transform = 'translateX(20px)';
            t.style.opacity = '0';
            setTimeout(() => t.remove(), 300);
        }, CONFIG.TOAST_DURATION);
    }

    // ==================== 页面识别模块 ====================
    /**
     * 智能识别当前页面是否为飞书多维表格/电子表格
     * 支持多版本飞书，通过URL特征+DOM特征双重校验
     */
    function isSheetPage() {
        // 关键：飞书表格单元格实际渲染在沙箱iframe中（location为about:blank），
        // 能被注入到这里本身就说明是飞书表格/文档页，直接放行，避免URL特征误判
        if (window.parent !== window || location.href === 'about:blank' || location.protocol === 'about:') {
            return true;
        }
        // 支持独立表格页(/sheets/ /base/ /bitable/)、知识库嵌入表(?sheet=)、文档嵌入表
        const urlMatch = /\/(sheets|base|bitable)\//.test(location.href)
                      || /[?&]sheet=/.test(location.href)
                      || /\/docx\//.test(location.href);
        const domMatch = !!document.querySelector(
            '.bitable-sandbox-container, .suite-sheet-container, .grid-container, [data-sheet-id], .bitable-app, .sheet-container, [class*="bitable-"], [class*="sheet-"]'
        );
        // Canvas 渲染的飞书电子表格（faster-single-canvas 等）
        const canvasMatch = !!document.querySelector(
            'canvas.faster-single-canvas, canvas[class*="faster-"], canvas[class*="sheet-canvas"], canvas[class*="grid-canvas"]'
        );
        return urlMatch || domMatch || canvasMatch;
    }

    // ==================== DOM智能解析模块 ====================
    /**
     * 从点击元素向上溯源，精准定位单元格根节点
     * 采用特征匹配算法，不依赖固定类名，兼容飞书前端迭代更新
     * @param {HTMLElement} el - 点击的起始元素
     * @returns {HTMLElement|null} 单元格根节点，找不到返回null
     */
    function findCellRoot(el) {
        let current = el;
        const selectorStr = CONFIG.CELL_SELECTORS.join(',');
        
        for (let i = 0; i < CONFIG.DOM_TRAVERSE_DEPTH; i++) {
            if (!current || current === document.body || current === document.documentElement) break;
            
            // 1. 优先匹配单元格特征类名/属性
            if (current.matches && current.matches(selectorStr)) {
                return current;
            }
            // 2. 检查是否存在单元格标识属性
            if (current.hasAttribute && (
                current.hasAttribute('data-cell-id') || 
                current.hasAttribute('data-cell-key') ||
                current.hasAttribute('data-col-id') ||
                current.hasAttribute('data-field-id') ||
                current.hasAttribute('data-record-id')
            )) {
                return current;
            }
            // 3. ARIA 网格单元格角色
            const role = current.getAttribute && current.getAttribute('role');
            if (role === 'gridcell' || role === 'cell' || role === 'columnheader') {
                return current;
            }
            // 4. td/th 在表格/网格容器内
            const tag = current.tagName;
            if (tag === 'TD' || tag === 'TH') {
                let p = current.parentElement;
                while (p && p !== document.body) {
                    if (p.tagName === 'TABLE' || p.matches('[role="grid"], [role="treegrid"], .grid-container, .bitable-app, .sheet-container')) {
                        return current;
                    }
                    p = p.parentElement;
                }
            }
        // 5. 智能特征：元素在行容器内，且有≥2个data-*属性，视为单元格
        if (current.parentElement) {
            const parent = current.parentElement;
            const parentIsRow = parent.matches('[role="row"], .slick-row, .bitable-row, .table-row, .grid-row, [data-row-id], [class*="row-"]');
            if (parentIsRow) {
                const dataAttrs = Array.from(current.attributes).filter(a => a.name.startsWith('data-')).length;
                if (dataAttrs >= 2) return current;
                // 行内直接子元素且类名含 cell/grid/bitable
                if (current.className && /cell|grid|bitable|column/i.test(current.className.toString())) return current;
            }
        }
        // 6. 编辑态单元格：飞书点击单元格后会渲染 textarea/input 作为编辑器，
        //    从编辑器向上找所在的"单元格容器"（类名含 cell/bitable/grid 或带 data-* 属性）
        if (current.tagName === 'TEXTAREA' || current.tagName === 'INPUT') {
            let p = current.parentElement;
            for (let j = 0; j < 8 && p && p !== document.body; j++) {
                if (p.matches && (p.matches(selectorStr) || p.matches('[class*="cell"],[class*="bitable"],[class*="grid"]') ||
                    (p.hasAttribute && (p.hasAttribute('data-row-id') || p.hasAttribute('data-col-id') || p.hasAttribute('data-record-id'))))) {
                    return p;
                }
                p = p.parentElement;
            }
            // 兜底：编辑器本身有值就算单元格
            if (current.value && current.value.trim().length > 0) return current;
        }
            
            current = current.parentElement;
        }
        return null;
    }

    /**
     * 从单元格节点提取干净的文本内容
     * 优先读取文本渲染容器，避免提取到隐藏元素、操作按钮等噪音
     * @param {HTMLElement} cell - 单元格根节点
     * @returns {string|null} 清洗后的话术文本，空单元格返回null
     */
    function extractCellText(cell) {
        // 编辑态单元格：textarea/input 直接读 value
        if (cell.tagName === 'TEXTAREA' || cell.tagName === 'INPUT') {
            const v = (cell.value || '').trim();
            if (v.length > 0) return v;
        }
        // 单元格内可能有正在编辑的 textarea/input（点击后飞书渲染编辑器）
        const editing = cell.querySelector('textarea, input[type="text"], input:not([type])');
        if (editing) {
            const v = (editing.value || '').trim();
            if (v.length > 0) return v;
        }
        // 优先匹配专门的文本容器
        for (const selector of CONFIG.TEXT_SELECTORS) {
            const el = cell.querySelector(selector);
            if (el) {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.length > 0) return text;
            }
        }
        
        // 第二优先级：取第一个有文本的直接/深层子元素（排除按钮图标等）
        const allTextNodes = [];
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const t = (node.textContent || '').trim();
                if (!t) return NodeFilter.FILTER_REJECT;
                let p = node.parentElement;
                while (p && p !== cell) {
                    if (p.tagName === 'BUTTON' || p.className && /icon|action|menu|checkbox|drag|resize/i.test(p.className.toString())) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    p = p.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            allTextNodes.push((n.textContent || '').trim());
        }
        if (allTextNodes.length > 0) {
            const combined = allTextNodes.join(' ').trim();
            if (combined.length > 0) return combined;
        }
        
        // Fallback: 提取整格文本，过滤子元素噪音
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('button, .icon, .action-menu, .cell-operation, .checkbox, [class*="icon"], [class*="action"], [class*="menu"]').forEach(e => e.remove());
        const text = (clone.innerText || clone.textContent || '').trim();
        
        return text.length > 0 ? text : null;
    }

    // ==================== Canvas 表格适配模块 ====================
    /**
     * 判断文本是否是单元格地址格式（如 E231、A1、AB123）
     */
    function isCellAddress(text) {
        if (!text || text.length > 10) return false;
        // 纯字母+数字（字母在前，数字在后），如 E231、AB123
        return /^[A-Z]{1,3}\d{1,7}$/.test(text.trim().toUpperCase());
    }

    /**
     * 飞书电子表格(sheets)使用 Canvas 渲染，单元格不是 DOM 元素。
     * 点击 canvas 后，飞书会在公式栏/编辑框中显示当前选中单元格的内容。
     * 此函数从这些 DOM 元素中提取文本，排除单元格地址框。
     * @returns {string|null} 单元格文本，找不到返回 null
     */
    function getEditorText() {
        // 按优先级尝试各种编辑框/公式栏选择器（排除地址框）
        const selectors = [
            // 1. 正在编辑的 textarea/input（双击进入编辑模式时）
            'textarea:not([style*="display: none"]):not([class*="address"]):not([class*="name-box"])',
            'input[type="text"]:not([style*="display: none"]):not([class*="address"]):not([class*="name-box"])',
            // 2. contenteditable 编辑框（公式栏内容区、单元格编辑器）
            '[contenteditable="true"]:not([style*="display: none"]):not([class*="address"]):not([class*="name-box"])',
            '[contenteditable=""]:not([style*="display: none"]):not([class*="address"]):not([class*="name-box"])',
            // 3. 公式栏内容区（单击选中单元格时显示内容）
            //    公式栏通常分左右：左边地址框，右边内容区。这里匹配内容区
            '[class*="formula-bar"] [class*="content"]',
            '[class*="formula-bar"] [class*="text"]',
            '[class*="formula-bar"] [class*="value"]',
            '[class*="formula-bar"] [class*="input"]',
            '[class*="formula-bar"] [contenteditable]',
            '[class*="formulaBar"] [class*="content"]',
            '[class*="formulaBar"] [contenteditable]',
            '[class*="formula-input"]',
            '[class*="formula-text"]',
            '[class*="formula-content"]',
            // 4. 飞书 faster 引擎的编辑器/公式栏
            '[class*="faster-"][class*="editor"]:not([class*="address"])',
            '[class*="faster-editor"]:not([class*="address"])',
            '[class*="faster-formula"] [class*="content"]',
            '[class*="faster-formula"] [contenteditable]',
            // 5. 通用编辑器/单元格编辑（排除地址框）
            '[class*="cell-editor"]:not([class*="address"])',
            '[class*="sheet-editor"]:not([class*="address"])',
            '[class*="grid-editor"]:not([class*="address"])',
            // 6. 选中单元格的显示层（canvas 上方的浮层，显示单元格内容）
            '[class*="cell-value"]:not([class*="address"])',
            '[class*="cell-display"]:not([class*="address"])',
            '[class*="selected-cell"] [class*="content"]',
            '[class*="selected-cell"] [class*="text"]',
            '[class*="active-cell"] [class*="content"]',
        ];

        for (const sel of selectors) {
            let els;
            try {
                els = document.querySelectorAll(sel);
            } catch (e) { continue; }
            for (const el of els) {
                // 跳过不可见或尺寸过小的元素
                const rect = el.getBoundingClientRect();
                if (rect.width < 10 || rect.height < 10) continue;
                if (rect.top < -100 || rect.left < -100) continue;
                // 跳过明显是地址框的元素
                const cls = (el.className && typeof el.className === 'string') ? el.className : '';
                if (/address|name-box|cell-ref|reference/i.test(cls)) continue;

                let text = '';
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    text = (el.value || '').trim();
                } else {
                    text = (el.innerText || el.textContent || '').trim();
                }
                // 过滤：非空、不是占位符、不是单元格地址
                if (text.length > 0 
                    && text !== '输入内容' && text !== '请输入'
                    && !isCellAddress(text)) {
                    return text;
                }
            }
        }
        return null;
    }

    /**
     * 判断点击目标是否在 Canvas 表格内
     * @param {HTMLElement} target - 点击目标
     * @returns {HTMLCanvasElement|null} canvas 元素，不是则返回 null
     */
    function getCanvasTarget(target) {
        if (!target) return null;
        if (target.tagName === 'CANVAS') return target;
        if (target.closest) {
            const canvas = target.closest('canvas');
            if (canvas) return canvas;
        }
        // 向上查找 canvas 容器（faster_container 等）
        let el = target;
        for (let i = 0; i < 6 && el; i++) {
            if (el.querySelector && el.querySelector('canvas.faster-single-canvas, canvas[class*="faster-"]')) {
                return el.querySelector('canvas.faster-single-canvas, canvas[class*="faster-"]');
            }
            el = el.parentElement;
        }
        return null;
    }

    // ==================== 剪贴板操作模块 ====================
    /**
     * 双策略降级复制方案
     * 优先使用现代Clipboard API，失败降级到execCommand兼容方案
     * @param {string} text - 要复制的文本
     * @returns {boolean} 是否复制成功
     */
    async function writeToClipboard(text) {
        // 策略1: Async Clipboard API (需要HTTPS/localhost，剪贴板写权限)
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (primaryErr) {
            // 策略2: Legacy execCommand (兼容iframe沙箱、旧版Chrome)
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.cssText = `
                    position: fixed; top: -9999px; left: -9999px;
                    opacity: 0; pointer-events: none;
                `;
                document.body.appendChild(textarea);
                textarea.select();
                textarea.setSelectionRange(0, text.length); // iOS兼容
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                return success;
            } catch (fallbackErr) {
                console.warn('[OutboundCopilot] 复制失败:', primaryErr, fallbackErr);
                return false;
            }
        }
    }

    // ==================== 多选区域复制模块 ====================
    let mouseDownPos = null;  // 记录 mousedown 位置，用于检测拖动选择
    let dragJustEnded = false; // 标记拖动选择刚结束，用于跳过后续的 click 事件

    /**
     * 模拟 Cmd+C 键盘事件，触发飞书表格的复制逻辑
     * 对于 Canvas 渲染的表格，需要通过键盘事件触发飞书内部的复制
     */
    function simulateCopy() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        // 找到 canvas 元素并聚焦
        const canvas = document.querySelector('canvas.faster-single-canvas, canvas[class*="faster-"], canvas[class*="sheet-canvas"]');
        if (canvas) {
            try { canvas.focus({ preventScroll: true }); } catch (e) {}
            canvas.tabIndex = canvas.tabIndex || 0;
        }

        // 构造键盘事件属性
        const keyProps = {
            key: 'c', code: 'KeyC', keyCode: 67, which: 67,
            metaKey: isMac, ctrlKey: !isMac,
            bubbles: true, cancelable: true, composed: true
        };

        // 在多个目标上派发事件（canvas + document + window），提高命中率
        const targets = [canvas, document.activeElement, document.body, document, window].filter(Boolean);
        const uniqueTargets = [...new Set(targets)];

        // 派发 keydown（飞书通常在 keydown 里处理复制快捷键）
        uniqueTargets.forEach(t => {
            try { t.dispatchEvent(new KeyboardEvent('keydown', keyProps)); } catch (e) {}
        });

        // 同时尝试 execCommand('copy') 作为兜底
        try {
            // 确保有焦点元素
            if (document.activeElement === document.body && canvas) {
                canvas.focus();
            }
            document.execCommand('copy');
        } catch (e) {
            console.log('[OutboundCopilot] execCommand copy 失败:', e);
        }

        // 派发 keyup
        setTimeout(() => {
            uniqueTargets.forEach(t => {
                try { t.dispatchEvent(new KeyboardEvent('keyup', keyProps)); } catch (e) {}
            });
        }, 20);
    }

    /**
     * 读取剪贴板文本内容（双策略降级）
     * @returns {Promise<string>} 剪贴板文本
     */
    async function readClipboardText() {
        // 策略1: Clipboard API
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.length > 0) return text;
        } catch (e) {
            console.log('[OutboundCopilot] Clipboard API 读取失败，降级到 execCommand');
        }
        // 策略2: textarea + execCommand('paste')
        try {
            const textarea = document.createElement('textarea');
            textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand('paste');
            const text = textarea.value;
            document.body.removeChild(textarea);
            if (success && text && text.length > 0) return text;
        } catch (e) {
            console.warn('[OutboundCopilot] execCommand paste 失败:', e);
        }
        return '';
    }

    /**
     * 检测是否为拖动选择（mousedown 和 mouseup 位置不同）
     */
    function isDragSelection(e) {
        if (!mouseDownPos) return false;
        const dx = Math.abs(e.clientX - mouseDownPos.x);
        const dy = Math.abs(e.clientY - mouseDownPos.y);
        const dt = Date.now() - mouseDownPos.time;
        // 拖动距离 > 8px 且持续时间 > 100ms，认为是拖动选择
        return (dx > 8 || dy > 8) && dt > 100;
    }

    // 监听 mousedown，记录起始位置
    document.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;  // 只处理左键
        if (!isSheetPage()) return;
        // 只在 canvas 表格内记录
        if (getCanvasTarget(e.target)) {
            mouseDownPos = { x: e.clientX, y: e.clientY, time: Date.now() };
        } else {
            mouseDownPos = null;
        }
    }, true);

    // 监听 mouseup，检测拖动选择并执行多选复制
    document.addEventListener('mouseup', async function(e) {
        if (e.button !== 0) return;
        if (!isSheetPage()) return;
        if (!mouseDownPos) return;

        const isDrag = isDragSelection(e);
        mouseDownPos = null;

        if (!isDrag) return;  // 单击走原来的 click 事件逻辑

        // 标记拖动刚结束，用于跳过后续的 click 事件（避免单击复制覆盖多选结果）
        dragJustEnded = true;
        setTimeout(() => { dragJustEnded = false; }, 500);

        // 拖动选择：等待飞书完成选中区域渲染
        setTimeout(async () => {
            // 模拟 Cmd+C 复制选中区域
            simulateCopy();
            // 等待复制完成
            setTimeout(async () => {
                const text = await readClipboardText();
                if (text && text.length > 0) {
                    // 统计行数和字符数
                    const lines = text.split('\n').filter(l => l.trim().length > 0);
                    const preview = text.length > 30 ? text.substring(0, 30) + '...' : text;
                    showToast(`✓ 已复制 ${lines.length} 行: ${preview}`);
                    console.log('[OutboundCopilot] 多选复制成功，共', lines.length, '行');
                } else {
                    showToast('多选复制失败，请重试', true);
                }
            }, 200);
        }, 150);
    }, true);

    // ==================== 事件处理入口 ====================
    /**
     * 点击事件捕获阶段处理
     * 使用捕获阶段优先于飞书原生事件处理，保证点击即复制
     */
    document.addEventListener('click', async function(e) {
        // 非表格页面直接放行
        if (!isSheetPage()) return;

        // 拖动选择刚结束时，跳过 click 事件（避免单击复制覆盖多选复制结果）
        if (dragJustEnded) {
            dragJustEnded = false;
            return;
        }
        
        // 防抖：冷却期内重复点击忽略
        const now = Date.now();
        if (now - lastCopyTime < CONFIG.COOLDOWN_MS) return;
        
        // 忽略双击、多击（双击通常是编辑单元格操作）
        if (e.detail > 1) return;
        
        // 忽略右键、中键点击
        if (e.button !== 0) return;

        // ===== Canvas 表格特殊处理（飞书电子表格用 canvas 渲染）=====
        const canvasEl = getCanvasTarget(e.target);
        if (canvasEl) {
            lastCopyTime = now; // 进入冷却
            // 等待飞书渲染选中状态和公式栏/编辑框内容
            setTimeout(async () => {
                // 先尝试从编辑框/公式栏获取
                let text = getEditorText();
                // 兜底：如果编辑框没内容，尝试从选中单元格附近的 DOM 浮层获取
                if (!text) {
                    // 优先匹配内容层（含 content/text/value），排除地址框
                    const contentSelectors = [
                        '[class*="selected"][class*="content"]',
                        '[class*="active"][class*="content"]',
                        '[class*="cell"][class*="content"]:not([class*="address"])',
                        '[class*="selected"][class*="text"]',
                        '[class*="active"][class*="text"]',
                        '[class*="cell"][class*="text"]:not([class*="address"])',
                        '[class*="selected"][class*="value"]',
                        '[class*="active"][class*="value"]',
                    ];
                    for (const sel of contentSelectors) {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            const rect = el.getBoundingClientRect();
                            if (rect.width < 15 || rect.height < 12) continue;
                            const t = (el.innerText || el.textContent || '').trim();
                            if (t && t.length > 0 && t.length < 5000 && !isCellAddress(t)) {
                                text = t;
                                break;
                            }
                        }
                        if (text) break;
                    }
                    // 再兜底：宽泛匹配，但严格排除地址
                    if (!text) {
                        const overlays = document.querySelectorAll('[class*="cell"]:not([class*="address"]):not([class*="name-box"]), [class*="selected"]:not([class*="address"]), [class*="active"]:not([class*="address"])');
                        for (const ov of overlays) {
                            const rect = ov.getBoundingClientRect();
                            if (rect.width > 20 && rect.height > 15 && rect.top > 50) {
                                const t = (ov.innerText || ov.textContent || '').trim();
                                if (t && t.length > 0 && t.length < 5000 && !isCellAddress(t)) {
                                    text = t;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (text) {
                    const success = await writeToClipboard(text);
                    if (success) {
                        const preview = text.length > 20 ? text.substring(0, 20) + '...' : text;
                        showToast(`✓ 已复制: ${preview}`);
                        console.log('[OutboundCopilot] Canvas表格复制成功:', text.substring(0, 50));
                    } else {
                        showToast('复制失败，请检查剪贴板权限', true);
                    }
                } else {
                    showToast('未获取到单元格内容（请单击选中单元格）', true);
                    console.log('[OutboundCopilot] Canvas表格未获取到内容');
                }
            }, 100); // 等待飞书渲染选中状态
            return;
        }

        // 智能识别单元格（非 canvas 表格，如 bitable 多维表格）
        const cellRoot = findCellRoot(e.target);
        if (!cellRoot) return;

        // 点击已进入处理流程即进入冷却，避免失败后250ms内重复点击反复空转
        lastCopyTime = now;

        const cellText = extractCellText(cellRoot);
        if (!cellText) {
            showToast('空单元格，未复制', true);
            return;
        }

        // 延迟执行，等待飞书原生选中/高亮逻辑完成
        setTimeout(async () => {
            const success = await writeToClipboard(cellText);
            
            if (success) {
                const preview = cellText.length > 20 ? cellText.substring(0, 20) + '...' : cellText;
                showToast(`✓ 已复制: ${preview}`);
                console.log('[OutboundCopilot] 复制成功:', cellText.substring(0, 50));
            } else {
                showToast('复制失败，请检查剪贴板权限', true);
            }
        }, CONFIG.COPY_DELAY_MS);
        
    }, true); // 使用捕获阶段，最高优先级拦截

    console.log('%c[OutboundCopilot] v1.0.1 已加载 🚀', 'color: #52c41a; font-weight: bold; font-size: 12px;');
})();
