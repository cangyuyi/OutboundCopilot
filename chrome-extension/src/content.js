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
        CELL_SELECTORS: [           // 飞书单元格特征匹配（多版本兼容）
            '.cell-main', '.bitable-cell', '.slick-cell', '.grid-cell',
            '[data-cell-id]', '[data-col-id]', '.cell-value', '.bitable-cell-content'
        ],
        TEXT_SELECTORS: [           // 单元格文本容器优先级
            '.cell-value', '.text-inner', '.content', '[data-text]',
            '.bitable-cell-text', '.cell-text'
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
        document.body.appendChild(t);

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
        const urlMatch = /\/(sheets|base|bitable)\//.test(location.href);
        const domMatch = !!document.querySelector(
            '.bitable-sandbox-container, .suite-sheet-container, .grid-container, [data-sheet-id], .bitable-app'
        );
        return urlMatch || domMatch;
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
            if (!current || current === document.body) break;
            
            // 1. 优先匹配单元格特征类名/属性
            if (current.matches && current.matches(selectorStr)) {
                return current;
            }
            // 2. 检查是否存在单元格标识属性
            if (current.hasAttribute && (
                current.hasAttribute('data-cell-id') || 
                current.hasAttribute('data-cell-key') ||
                current.hasAttribute('data-col-id')
            )) {
                return current;
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
        // 优先匹配专门的文本容器
        for (const selector of CONFIG.TEXT_SELECTORS) {
            const el = cell.querySelector(selector);
            if (el) {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.length > 0) return text;
            }
        }
        
        // Fallback: 提取整格文本，过滤子元素噪音
        const clone = cell.cloneNode(true);
        // 移除所有按钮、图标、操作菜单等干扰元素
        clone.querySelectorAll('button, .icon, .action-menu, .cell-operation, .checkbox').forEach(e => e.remove());
        const text = (clone.innerText || clone.textContent || '').trim();
        
        return text.length > 0 ? text : null;
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

    // ==================== 事件处理入口 ====================
    /**
     * 点击事件捕获阶段处理
     * 使用捕获阶段优先于飞书原生事件处理，保证点击即复制
     */
    document.addEventListener('click', async function(e) {
        // 非表格页面直接放行
        if (!isSheetPage()) return;
        
        // 防抖：冷却期内重复点击忽略
        const now = Date.now();
        if (now - lastCopyTime < CONFIG.COOLDOWN_MS) return;
        
        // 忽略双击、多击（双击通常是编辑单元格操作）
        if (e.detail > 1) return;
        
        // 忽略右键、中键点击
        if (e.button !== 0) return;

        // 智能识别单元格
        const cellRoot = findCellRoot(e.target);
        if (!cellRoot) return;

        const cellText = extractCellText(cellRoot);
        if (!cellText) {
            showToast('空单元格，未复制', true);
            return;
        }

        // 延迟执行，等待飞书原生选中/高亮逻辑完成
        setTimeout(async () => {
            const success = await writeToClipboard(cellText);
            lastCopyTime = now;
            
            if (success) {
                const preview = cellText.length > 20 ? cellText.substring(0, 20) + '...' : cellText;
                showToast(`✓ 已复制: ${preview}`);
                console.log('[OutboundCopilot] 复制成功:', cellText.substring(0, 50));
            } else {
                showToast('复制失败，请检查剪贴板权限', true);
            }
        }, CONFIG.COPY_DELAY_MS);
        
    }, true); // 使用捕获阶段，最高优先级拦截

    console.log('%c[OutboundCopilot] v1.0.0 已加载 🚀', 'color: #52c41a; font-weight: bold; font-size: 12px;');
})();
