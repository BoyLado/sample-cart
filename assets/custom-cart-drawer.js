// assets/custom-cart-drawer.js
// Complete AJAX Cart Drawer - with auto-scroll to top on refresh

(function() {
    'use strict';

    console.log('[Cart Drawer] Script loaded');

    const CONFIG = {
        cartIconSelectors: [
            '#ccd-cart-icon',
            '.header__icons a[href*="/cart"]',
            '.header__icon-link--cart',
            'a[href*="/cart"]'
        ],
        cartUrl: '/cart',
        cartChangeUrl: '/cart/change.js',
        cartAddUrl: '/cart/add.js',
        productsJsonUrl: '/products.json?limit=250',
        activeClass: 'is-active',
        updatingClass: 'is-updating',
        completeClass: 'is-complete',
        debounceDelay: 300,
        cacheTimeout: 5000,
        maxUpsellProducts: 5,
        minSkeletonTime: 400,
        refreshDelay: 500,
    };

    class CartDrawer {
        constructor() {
            this.cart = null;
            this.isOpen = false;
            this.isUpdating = false;
            this.elements = {};
            this.updateTimeout = null;
            this.cartIcon = null;
            this.sliderCurrentIndex = 0;
            this.sliderTotalSlides = 0;
            this.slideGapPx = 12;
            this.shippingAccordionProducts = null;
            this._accordionResizeBound = false;
            this._cartUpdateHandler = this._cartUpdateHandler.bind(this);
            this._refreshPending = false;

            this.getSettings();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        getSettings() {
            const root = document.getElementById('ccd-root');
            if (root) {
                const styles = getComputedStyle(root);
                this.freeShippingThreshold = parseInt(styles.getPropertyValue('--ccd-free-shipping-threshold').trim()) || 100;
                this.maxQuantity = parseInt(styles.getPropertyValue('--ccd-max-quantity').trim()) || 999;
            } else {
                this.freeShippingThreshold = 100;
                this.maxQuantity = 999;
            }
        }

        init() {
            this.cacheElements();
            this.findCartIcon();
            this.bindEvents();
            this.setupAddToCartListener();
            this.preFetchCart();
        }

        cacheElements() {
            this.elements = {
                drawer: document.getElementById('ccd-drawer'),
                drawerInner: document.querySelector('#ccd-drawer .ccd-drawer__inner'),
                overlay: document.getElementById('ccd-overlay'),
                closeButton: document.getElementById('ccd-close-btn'),
                cartItems: document.getElementById('ccd-cart-items'),
                cartEmpty: document.getElementById('ccd-empty'),
                skeleton: document.getElementById('ccd-skeleton'),
                content: document.getElementById('ccd-content'),
                savings: document.getElementById('ccd-savings'),
                savingsRow: document.getElementById('ccd-savings-row'),
                checkoutAmount: document.getElementById('ccd-checkout-amount'),
                checkoutCount: document.getElementById('ccd-checkout-count'),
                shippingBar: document.getElementById('ccd-shipping-bar'),
                shippingFill: document.getElementById('ccd-shipping-fill'),
                shippingText: document.getElementById('ccd-shipping-text'),
                shippingSuccess: document.getElementById('ccd-shipping-success'),
                shippingRemaining: document.getElementById('ccd-shipping-remaining'),
                checkoutBtn: document.getElementById('ccd-checkout-btn'),
                shippingWrapper: document.getElementById('ccd-shipping-wrapper'),
                shippingAccordion: document.getElementById('ccd-shipping-accordion'),
                footer: document.getElementById('ccd-footer'),
                upsellSlider: document.getElementById('ccd-upsell-slider'),
                upsellPrev: document.querySelector('.ccd-upsell-prev'),
                upsellNext: document.querySelector('.ccd-upsell-next'),
                upsellDots: document.getElementById('ccd-upsell-dots'),
                headerCount: document.getElementById('ccd-header-count'),
                upsellCounter: document.getElementById('ccd-upsell-counter'),
                shippingAccordionGrid: document.getElementById('ccd-shipping-accordion-grid'),
                bodyWrapper: document.querySelector('.ccd-body-wrapper'), // for scrolling
            };
        }

        findCartIcon() {
            for (const selector of CONFIG.cartIconSelectors) {
                const icon = document.querySelector(selector);
                if (icon) { this.cartIcon = icon; break; }
            }
            if (!this.cartIcon) {
                const allLinks = document.querySelectorAll('a');
                for (const link of allLinks) {
                    if (link.getAttribute('href')?.includes('/cart')) { this.cartIcon = link; break; }
                }
            }
        }

        async preFetchCart() {
            try {
                this.cart = await this.getCart();
                this.updateCartCount(this.cart.item_count);
            } catch (error) {}
        }

        async getCart(forceRefresh = false) {
            try {
                const response = await fetch(CONFIG.cartUrl, {
                    credentials: 'same-origin',
                    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
                });
                if (!response.ok) throw new Error('Failed to fetch cart');
                return await response.json();
            } catch (error) {
                console.error('[Cart Drawer] Failed to fetch cart:', error);
                throw error;
            }
        }

        async changeItem(line, quantity) {
            const response = await fetch(CONFIG.cartChangeUrl, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ line, quantity })
            });
            if (!response.ok) throw new Error('Failed to update cart');
            return await response.json();
        }

        async addItem(variantId, quantity = 1) {
            const response = await fetch(CONFIG.cartAddUrl, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ id: variantId, quantity })
            });
            if (!response.ok) throw new Error('Failed to add item');
            return await response.json();
        }

        // ========== ADD-TO-CART LISTENER ==========
        setupAddToCartListener() {
            document.addEventListener('cart:updated', this._cartUpdateHandler);
            document.addEventListener('product:added', this._cartUpdateHandler);
            document.addEventListener('cart:change', this._cartUpdateHandler);

            document.addEventListener('submit', (e) => {
                const form = e.target.closest('form[action*="/cart/add"]');
                if (!form) return;
                setTimeout(() => {
                    this.refreshAndOpenDrawer();
                }, CONFIG.refreshDelay);
            });

            document.addEventListener('click', (e) => {
                const button = e.target.closest('button, input[type="submit"]');
                if (!button) return;
                const isAddButton = 
                    button.name === 'add' ||
                    button.classList.contains('product-form__submit') ||
                    button.closest('form[action*="/cart/add"]') ||
                    button.getAttribute('data-add-to-cart') !== null ||
                    button.dataset.variantId ||
                    button.dataset.id;

                if (isAddButton) {
                    const form = button.closest('form');
                    if (!form || !form.getAttribute('action')?.includes('/cart/add')) {
                        setTimeout(() => {
                            this.refreshAndOpenDrawer();
                        }, CONFIG.refreshDelay);
                    }
                }
            });
        }

        _cartUpdateHandler(event) {
            console.log('[Cart Drawer] Cart update event detected');
            const detail = event.detail || {};
            if (detail.cart || detail.items) {
                const cartData = detail.cart || detail;
                if (cartData.items) {
                    this.cart = cartData;
                    this.openDrawerWithCart(cartData);
                    return;
                }
            }
            this.refreshAndOpenDrawer();
        }

        async refreshAndOpenDrawer() {
            if (this._refreshPending) return;
            this._refreshPending = true;

            try {
                const cartData = await this.getCart(true);
                this.cart = cartData;
                this.openDrawerWithCart(cartData);
            } catch (error) {
                console.error('[Cart Drawer] Failed to refresh cart:', error);
            } finally {
                this._refreshPending = false;
            }
        }

        openDrawerWithCart(cartData) {
            if (!cartData) return;
            if (!this.isOpen) {
                this.openDrawer(cartData);
            } else {
                this.renderCart(cartData);
                this.updateCartCount(cartData.item_count);
                // Scroll to top after re-render
                this.scrollToTop();
            }
        }
        // ============================================

        bindEvents() {
            if (this.cartIcon) {
                const newIcon = this.cartIcon.cloneNode(true);
                this.cartIcon.parentNode.replaceChild(newIcon, this.cartIcon);
                this.cartIcon = newIcon;
                this.cartIcon.addEventListener('click', (e) => { 
                    e.preventDefault(); 
                    this.openDrawer(); 
                });
            }

            if (this.elements.closeButton) {
                this.elements.closeButton.addEventListener('click', () => this.closeDrawer());
            }
            
            if (this.elements.overlay) {
                this.elements.overlay.addEventListener('click', (e) => { 
                    if (e.target === this.elements.overlay) this.closeDrawer(); 
                });
            }
            
            document.addEventListener('keydown', (e) => { 
                if (e.key === 'Escape' && this.isOpen) this.closeDrawer(); 
            });

            const drawerElement = this.elements.drawer;
            if (drawerElement) {
                drawerElement.addEventListener('click', (e) => {
                    const target = e.target.closest('button');
                    if (!target) return;
                    if (target.classList.contains('ccd-item__remove')) {
                        e.preventDefault();
                        this.handleRemoveItem(target);
                    } else if (target.classList.contains('ccd-qty__btn--minus')) {
                        e.preventDefault();
                        this.handleQuantityChange(target, -1);
                    } else if (target.classList.contains('ccd-qty__btn--plus')) {
                        e.preventDefault();
                        this.handleQuantityChange(target, 1);
                    }
                });

                const upsellSlider = this.elements.upsellSlider;
                if (upsellSlider) {
                    upsellSlider.addEventListener('click', (e) => {
                        const addBtn = e.target.closest('.ccd-upsell-slide__add');
                        if (!addBtn) return;
                        e.preventDefault();
                        this.handleUpsellAdd(addBtn);
                    });
                }
            }

            document.addEventListener('input', (e) => {
                const input = e.target.closest('input[type="number"]');
                if (!input || !e.target.closest('#ccd-drawer')) return;
                this.debounceQuantityInput(input);
            });

            if (this.elements.shippingWrapper) {
                const bar = this.elements.shippingWrapper.querySelector('.ccd-shipping-bar');
                if (bar) {
                    bar.addEventListener('click', () => {
                        const isOpening = !this.elements.shippingWrapper.classList.contains('is-open');
                        this.elements.shippingWrapper.classList.toggle('is-open');

                        if (isOpening) {
                            this.positionShippingAccordion();
                            if (!this._accordionResizeBound) {
                                window.addEventListener('resize', () => {
                                    if (this.elements.shippingWrapper.classList.contains('is-open')) {
                                        this.positionShippingAccordion();
                                    }
                                });
                                this._accordionResizeBound = true;
                            }
                        }
                    });
                }
            }

            const shippingGrid = this.elements.shippingAccordionGrid;
            if (shippingGrid) {
                shippingGrid.addEventListener('click', (e) => {
                    const btn = e.target.closest('.ccd-shipping-accordion-product__add');
                    if (!btn) return;
                    e.preventDefault();
                    this.handleShippingAccordionAdd(btn);
                });
            }
        }

        positionShippingAccordion() {
            const accordion = this.elements.shippingAccordion;
            const wrapper = this.elements.shippingWrapper;
            const footer = this.elements.footer;
            const drawerInner = this.elements.drawerInner;
            if (!accordion || !wrapper || !footer || !drawerInner) return;

            const bar = wrapper.querySelector('.ccd-shipping-bar');
            const header = drawerInner.querySelector('.ccd-header');

            const headerHeight = header ? header.offsetHeight : 0;
            const barHeight = bar ? bar.offsetHeight : 0;
            const footerHeight = footer.offsetHeight;

            accordion.style.top = (headerHeight + barHeight) + 'px';
            accordion.style.bottom = footerHeight + 'px';
        }

        // ===== SCROLL TO TOP =====
        scrollToTop() {
            const wrapper = this.elements.bodyWrapper;
            if (wrapper) {
                wrapper.scrollTop = 0;
            }
        }

        async openDrawer(initialCart = null) {
            if (this.isOpen) return;
            
            if (this.elements.drawer) this.elements.drawer.classList.add(CONFIG.activeClass);
            if (this.elements.overlay) this.elements.overlay.classList.add(CONFIG.activeClass);
            document.body.classList.add('ccd-drawer-open');
            this.isOpen = true;
            
            this.showSkeleton();
            
            const startTime = Date.now();
            try {
                if (initialCart) {
                    this.cart = initialCart;
                } else {
                    this.cart = await this.getCart(true);
                }
                
                const elapsed = Date.now() - startTime;
                const remaining = CONFIG.minSkeletonTime - elapsed;
                if (remaining > 0) {
                    await new Promise(resolve => setTimeout(resolve, remaining));
                }
                
                this.hideSkeleton();
                this.renderCart(this.cart);
                this.updateCartCount(this.cart.item_count);
                // Scroll to top after rendering
                this.scrollToTop();
                
                if (!this.shippingAccordionProducts) {
                    await this.loadShippingAccordionProducts();
                }
            } catch (error) {
                this.hideSkeleton();
                if (!this.cart) this.showError('Failed to load cart');
            }
        }

        closeDrawer() {
            if (!this.isOpen) return;
            
            if (this.elements.drawer) this.elements.drawer.classList.remove(CONFIG.activeClass);
            if (this.elements.overlay) this.elements.overlay.classList.remove(CONFIG.activeClass);
            document.body.classList.remove('ccd-drawer-open');
            
            if (this.elements.shippingWrapper) {
                this.elements.shippingWrapper.classList.remove('is-open');
            }
            
            this.shippingAccordionProducts = null;
            this.isOpen = false;
        }

        showSkeleton() {
            if (this.elements.skeleton) {
                this.elements.skeleton.removeAttribute('hidden');
            }
            if (this.elements.content) {
                this.elements.content.setAttribute('hidden', 'hidden');
            }
            if (this.elements.cartEmpty) {
                this.elements.cartEmpty.setAttribute('hidden', 'hidden');
            }
        }

        hideSkeleton() {
            if (this.elements.skeleton) {
                this.elements.skeleton.setAttribute('hidden', 'hidden');
            }
        }

        renderCart(cart) {
            if (!cart) return;
            
            // Remove empty-state class from body (cart has items)
            document.body.classList.remove('ccd-cart-empty');
            
            this.hideSkeleton();
            
            if (cart.item_count === 0) {
                this.showEmptyState();
                this.initUpsellSlider();
                return;
            }
            
            if (this.elements.content) {
                this.elements.content.removeAttribute('hidden');
            }
            if (this.elements.cartEmpty) {
                this.elements.cartEmpty.setAttribute('hidden', 'hidden');
            }
            
            this.renderItems(cart.items);
            this.updateShippingBar(cart);
            this.updateSummary(cart);
            this.updateCheckoutButton(cart);
            this.updateCartCount(cart.item_count);
            this.initUpsellSlider();
            
            if (this.elements.shippingWrapper) {
                this.elements.shippingWrapper.classList.remove('is-open');
            }
            
            if (this.elements.shippingWrapper?.classList.contains('is-open')) {
                this.positionShippingAccordion();
            }
        }

        renderItems(items) {
            const container = this.elements.content;
            if (!container) return;
            
            let html = '';
            items.forEach((item, index) => {
                html += this.createItemHTML(item, index);
            });
            container.innerHTML = html;
        }

        createItemHTML(item, index) {
            const price = this.formatMoney(item.price);
            const lineTotal = this.formatMoney(item.line_price);
            
            let comparePrice = '';
            if (item.compare_at_price && item.compare_at_price > item.price) {
                comparePrice = `<span class="ccd-item__price--compare">${this.formatMoney(item.compare_at_price)}</span>`;
            }
            
            let variant = '';
            if (item.variant_title) {
                variant = `<p class="ccd-item__variant">${item.variant_title}</p>`;
            }
            
            let imageUrl = item.image || 'https://placehold.co/120x120/f4f4f4/999999?text=No+Image';
            const maxQty = Math.min(item.quantity_max || this.maxQuantity, this.maxQuantity);
            const isMinusDisabled = item.quantity <= 1;
            const isPlusDisabled = item.quantity >= maxQty;
            const lineNumber = item.line || (index + 1);
            
            return `
                <div class="ccd-item" data-line="${lineNumber}" data-variant-id="${item.variant_id}">
                    <div class="ccd-item__image-wrap">
                        <img class="ccd-item__image" src="${imageUrl}" alt="${this.escapeHTML(item.product_title)}" width="80" height="80" loading="lazy">
                    </div>
                    <div class="ccd-item__details">
                        <p class="ccd-item__title">${this.escapeHTML(item.product_title)}</p>
                        ${variant}
                        <p class="ccd-item__price">
                            ${comparePrice}
                            <span class="ccd-item__price--sale">${price}</span>
                        </p>
                        <div class="ccd-item__footer-row">
                            <div class="ccd-qty">
                                <button type="button" class="ccd-qty__btn ccd-qty__btn--minus" ${isMinusDisabled ? 'disabled' : ''}>−</button>
                                <span class="ccd-qty__value">${item.quantity}</span>
                                <button type="button" class="ccd-qty__btn ccd-qty__btn--plus" ${isPlusDisabled ? 'disabled' : ''}>+</button>
                            </div>
                            <div class="ccd-item__end">
                                <span class="ccd-item__line-total">${lineTotal}</span>
                                <button type="button" class="ccd-item__remove">×</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        showEmptyState() {
            // Add class to body to trigger empty-state upsell highlight
            document.body.classList.add('ccd-cart-empty');
            
            if (this.elements.content) {
                this.elements.content.setAttribute('hidden', 'hidden');
            }
            if (this.elements.cartEmpty) {
                this.elements.cartEmpty.removeAttribute('hidden');
            }
            if (this.elements.shippingBar) {
                this.elements.shippingBar.setAttribute('hidden', 'hidden');
            }
            this.updateCheckoutButton(null);
        }

        // ===== HEADER CART COUNT SYNC =====
        updateCartCount(count) {
            // 1. Update the count inside the drawer header
            const headerEl = this.elements.headerCount;
            if (headerEl) {
                headerEl.textContent = `(${count || 0})`;
            }

            // 2. Update all header cart bubbles and count elements
            const cartLinks = document.querySelectorAll('a[href*="/cart"]');
            const countValue = count || 0;

            cartLinks.forEach(link => {
                const bubble = link.querySelector('.cart-count-bubble');
                if (bubble) {
                    if (countValue > 0) {
                        bubble.style.display = '';
                        bubble.removeAttribute('hidden');
                        const countSpan = bubble.querySelector('.ccd-cart-count, .cart-count, .count');
                        if (countSpan) {
                            countSpan.textContent = countValue;
                        }
                    } else {
                        bubble.style.display = 'none';
                        bubble.setAttribute('hidden', 'hidden');
                    }
                } else {
                    const countSpan = link.querySelector('.ccd-cart-count, .cart-count, .count, .js-cart-count');
                    if (countSpan) {
                        if (countValue > 0) {
                            countSpan.textContent = countValue;
                            countSpan.style.display = '';
                            countSpan.removeAttribute('hidden');
                        } else {
                            countSpan.style.display = 'none';
                            countSpan.setAttribute('hidden', 'hidden');
                        }
                    }
                }
            });

            // 3. Fallback selectors
            const fallbackSelectors = [
                '.header__cart-count',
                '.cart-count',
                '.js-cart-count',
                '.site-header__cart-count',
                '.header-cart__count',
                '.cart__count',
                '[data-cart-count]',
                '[data-cart-count-bubble]',
                '.header__icon--cart .count',
                '.header__cart-link .count',
                '.cart-icon__count',
                '.nav-cart__count',
                '.mini-cart__count',
                '[class*="cart-count"]',
                '[class*="cart-bubble"]'
            ];

            fallbackSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    if (el.closest('#ccd-root')) return;
                    if (countValue > 0) {
                        el.textContent = countValue;
                        el.style.display = '';
                        el.removeAttribute('hidden');
                    } else {
                        el.style.display = 'none';
                        el.setAttribute('hidden', 'hidden');
                    }
                });
            });

            // 4. Update aria-label
            cartLinks.forEach(link => {
                const label = link.getAttribute('aria-label') || '';
                if (label.toLowerCase().includes('cart')) {
                    const newLabel = countValue > 0 ? `Cart (${countValue} items)` : 'Cart (0)';
                    link.setAttribute('aria-label', newLabel);
                }
            });

            document.dispatchEvent(new CustomEvent('cart:count-updated', { detail: { count: countValue } }));
        }
        // ===========================================

        updateShippingBar(cart) {
            const bar = this.elements.shippingBar;
            if (!bar || !cart || cart.item_count === 0) {
                if (bar) bar.setAttribute('hidden', 'hidden');
                return;
            }
            
            const subtotal = cart.total_price / 100;
            const threshold = this.freeShippingThreshold;
            const remaining = Math.max(0, threshold - subtotal);
            const progress = Math.min((subtotal / threshold) * 100, 100);
            const isUnlocked = remaining <= 0;
            
            if (this.elements.shippingFill) {
                this.elements.shippingFill.style.width = progress + '%';
                this.elements.shippingFill.style.display = 'block';
                const successColor = getComputedStyle(document.getElementById('ccd-root')).getPropertyValue('--ccd-progress-success-color').trim() || '#2e7d32';
                const fillColor = getComputedStyle(document.getElementById('ccd-root')).getPropertyValue('--ccd-progress-fill-color').trim() || '#1a1a1a';
                this.elements.shippingFill.style.background = isUnlocked ? successColor : fillColor;
                this.elements.shippingFill.classList.toggle(CONFIG.completeClass, isUnlocked);
            }
            
            if (this.elements.shippingText) {
                if (isUnlocked) {
                    this.elements.shippingText.setAttribute('hidden', 'hidden');
                } else {
                    this.elements.shippingText.removeAttribute('hidden');
                    if (this.elements.shippingRemaining) {
                        this.elements.shippingRemaining.textContent = this.formatMoney(remaining * 100);
                    }
                }
            }
            
            if (this.elements.shippingSuccess) {
                if (isUnlocked) {
                    this.elements.shippingSuccess.removeAttribute('hidden');
                } else {
                    this.elements.shippingSuccess.setAttribute('hidden', 'hidden');
                }
            }
            
            bar.removeAttribute('hidden');
            bar.style.display = 'block';
        }

        updateSummary(cart) {
            const total = cart.total_price;
            const originalTotal = cart.original_total_price || total;
            const savings = originalTotal - total;
            
            if (this.elements.savingsRow) {
                if (savings > 0) {
                    if (this.elements.savings) {
                        this.elements.savings.textContent = this.formatMoney(savings);
                    }
                    this.elements.savingsRow.removeAttribute('hidden');
                } else {
                    this.elements.savingsRow.setAttribute('hidden', 'hidden');
                }
            }
        }

        updateCheckoutButton(cart) {
            const btn = this.elements.checkoutBtn;
            if (!btn) return;
            
            const countEl = this.elements.checkoutCount;
            const amountEl = this.elements.checkoutAmount;
            
            if (cart && cart.item_count > 0) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
                btn.disabled = false;
                if (countEl) countEl.textContent = cart.item_count;
                if (amountEl) amountEl.textContent = this.formatMoney(cart.total_price);
            } else {
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
                btn.disabled = true;
                if (countEl) countEl.textContent = '0';
                if (amountEl) amountEl.textContent = '$0.00';
            }
        }

        async loadShippingAccordionProducts() {
            const grid = this.elements.shippingAccordionGrid;
            if (!grid) return;
            
            try {
                const response = await fetch('/products.json?limit=50');
                if (!response.ok) throw new Error('Failed to fetch products');
                const data = await response.json();
                
                let products = data.products.filter(p => 
                    p.published_at && 
                    p.variants && 
                    p.variants.some(v => v.available && this.toCents(v.price) > 0)
                );
                
                const count = Math.min(10, products.length);
                const selected = [];
                const temp = [...products];
                for (let i = 0; i < count; i++) {
                    const randomIndex = Math.floor(Math.random() * temp.length);
                    selected.push(temp.splice(randomIndex, 1)[0]);
                }
                
                this.shippingAccordionProducts = selected;
                this.renderShippingAccordionGrid();
            } catch (error) {
                console.error('[Cart Drawer] Failed to load shipping accordion products:', error);
                if (grid) {
                    grid.innerHTML = '<p style="text-align:center;color:var(--ccd-text-muted);">No products available</p>';
                }
            }
        }

        renderShippingAccordionGrid() {
            const grid = this.elements.shippingAccordionGrid;
            if (!grid || !this.shippingAccordionProducts) return;
            
            let html = '';
            this.shippingAccordionProducts.forEach(product => {
                const variant = product.variants.find(v => v.available && this.toCents(v.price) > 0) || product.variants[0];
                const image = product.images[0]?.src || 'https://placehold.co/200x200/f4f4f4/999999?text=No+Image';
                const price = this.formatMoney(this.toCents(variant.price));
                
                html += `
                    <div class="ccd-shipping-accordion-product" data-variant-id="${variant.id}">
                        <img class="ccd-shipping-accordion-product__image" src="${image}" alt="${this.escapeHTML(product.title)}" loading="lazy">
                        <p class="ccd-shipping-accordion-product__title">${this.escapeHTML(product.title).substring(0, 40)}</p>
                        <div class="ccd-shipping-accordion-product__pricing">
                            <span class="ccd-shipping-accordion-product__price">${price}</span>
                        </div>
                        <button class="ccd-shipping-accordion-product__add" data-variant-id="${variant.id}">+ Add</button>
                    </div>
                `;
            });
            
            grid.innerHTML = html;
            
            if (this.elements.shippingWrapper?.classList.contains('is-open')) {
                this.positionShippingAccordion();
            }
        }

        async handleShippingAccordionAdd(button) {
            const variantId = parseInt(button.dataset.variantId);
            if (!variantId) return;
            
            button.disabled = true;
            const originalText = button.textContent;
            this.showSkeleton();
            
            try {
                await this.addItem(variantId, 1);
                this.cart = await this.getCart(true);
                this.renderCart(this.cart);
                this.updateCartCount(this.cart.item_count);
                this.scrollToTop(); // scroll after adding
                
                button.textContent = '✓ Added';
                button.style.background = '#2e7d32';
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '';
                    button.disabled = false;
                }, 2000);
            } catch (error) {
                this.hideSkeleton();
                this.showError('Failed to add item');
                button.textContent = originalText;
                button.disabled = false;
            }
        }

        // ===== UPSELL SLIDER =====
        async initUpsellSlider() {
            const slider = this.elements.upsellSlider;
            if (!slider) return;
            
            const upsellSection = document.getElementById('ccd-upsell');
            const isCollectionSet = upsellSection?.dataset?.collectionSet === 'true';
            if (!isCollectionSet) {
                await this.loadRandomProducts();
            }

            let slides = Array.from(slider.querySelectorAll('.ccd-upsell-slide'));
            if (slides.length === 0) return;
            
            this.shuffleArray(slides);
            slides.forEach(slide => slider.appendChild(slide));
            slides = Array.from(slider.querySelectorAll('.ccd-upsell-slide'));
            
            if (slides.length <= 1) {
                if (this.elements.upsellPrev) this.elements.upsellPrev.style.display = 'none';
                if (this.elements.upsellNext) this.elements.upsellNext.style.display = 'none';
                if (this.elements.upsellDots) this.elements.upsellDots.style.display = 'none';
                if (this.elements.upsellCounter) {
                    this.elements.upsellCounter.textContent = '1/1';
                }
                return;
            }
            
            this.sliderTotalSlides = slides.length;
            this.sliderSlidesPerView = this.getSlidesPerView();
            const computedStyle = getComputedStyle(slider);
            this.slideGapPx = parseFloat(computedStyle.columnGap) || 12;
            this.sliderCurrentIndex = 0;
            
            this.createUpsellDots();
            this.updateUpsellSlider();

            if (this.elements.upsellPrev && !this._upsellPrevBound) {
                this.elements.upsellPrev.addEventListener('click', () => {
                    if (this.sliderCurrentIndex > 0) {
                        this.sliderCurrentIndex--;
                        this.updateUpsellSlider();
                    }
                });
                this._upsellPrevBound = true;
            }
            
            if (this.elements.upsellNext && !this._upsellNextBound) {
                this.elements.upsellNext.addEventListener('click', () => {
                    if (this.sliderCurrentIndex < this.sliderTotalSlides - 1) {
                        this.sliderCurrentIndex++;
                        this.updateUpsellSlider();
                    }
                });
                this._upsellNextBound = true;
            }

            if (!this._touchBound) {
                const wrapper = slider.closest('.ccd-upsell-slider-wrapper');
                if (wrapper) {
                    let touchStartX = 0;
                    wrapper.addEventListener('touchstart', (e) => {
                        touchStartX = e.changedTouches[0].screenX;
                    }, { passive: true });
                    
                    wrapper.addEventListener('touchend', (e) => {
                        const touchEndX = e.changedTouches[0].screenX;
                        const diff = touchStartX - touchEndX;
                        if (Math.abs(diff) > 50) {
                            if (diff > 0 && this.sliderCurrentIndex < this.sliderTotalSlides - 1) {
                                this.sliderCurrentIndex++;
                                this.updateUpsellSlider();
                            } else if (diff < 0 && this.sliderCurrentIndex > 0) {
                                this.sliderCurrentIndex--;
                                this.updateUpsellSlider();
                            }
                        }
                    }, { passive: true });
                }
                this._touchBound = true;
            }
        }

        async loadRandomProducts() {
            try {
                const response = await fetch(CONFIG.productsJsonUrl);
                if (!response.ok) throw new Error('Failed to fetch products');
                const data = await response.json();
                
                let products = data.products || [];
                products = products.filter(p => {
                    if (!p.published_at) return false;
                    if (!p.variants) return false;
                    return p.variants.some(v => {
                        const cents = this.toCents(v.price);
                        return v.available && cents > 0;
                    });
                });
                
                if (products.length === 0) {
                    const upsellSection = document.getElementById('ccd-upsell');
                    if (upsellSection) upsellSection.style.display = 'none';
                    return;
                }
                
                const count = Math.min(CONFIG.maxUpsellProducts, products.length);
                const selected = [];
                const temp = [...products];
                for (let i = 0; i < count; i++) {
                    const randomIndex = Math.floor(Math.random() * temp.length);
                    selected.push(temp.splice(randomIndex, 1)[0]);
                }
                
                let html = '';
                selected.forEach(product => {
                    const variant = product.variants.find(v => {
                        const cents = this.toCents(v.price);
                        return v.available && cents > 0;
                    }) || product.variants[0];
                    
                    const image = product.images[0]?.src || 'https://placehold.co/200x200/f4f4f4/999999?text=No+Image';
                    const price = this.formatMoney(this.toCents(variant.price));
                    const compareAt = variant.compare_at_price ? this.formatMoney(this.toCents(variant.compare_at_price)) : null;
                    const showCompare = compareAt && this.toCents(variant.compare_at_price) > this.toCents(variant.price);
                    const saleBadge = showCompare ? '<span class="ccd-upsell-slide__badge">Sale</span>' : '';
                    
                    html += `
                        <div class="ccd-upsell-slide" data-variant-id="${variant.id}">
                            <div class="ccd-upsell-slide__image-wrap">
                                <img class="ccd-upsell-slide__image" src="${image}" alt="${this.escapeHTML(product.title)}" width="80" height="80" loading="lazy">
                                ${saleBadge}
                            </div>
                            <div class="ccd-upsell-slide__details">
                                <p class="ccd-upsell-slide__title">${this.escapeHTML(product.title).substring(0, 30)}</p>
                                <div class="ccd-upsell-slide__pricing">
                                    <span class="ccd-upsell-slide__price">${price}</span>
                                    ${showCompare ? `<span class="ccd-upsell-slide__compare">${compareAt}</span>` : ''}
                                </div>
                            </div>
                            <button type="button" class="ccd-upsell-slide__add" data-variant-id="${variant.id}">+ Add</button>
                        </div>
                    `;
                });
                
                this.elements.upsellSlider.innerHTML = html;
                console.log(`[Cart Drawer] Loaded ${selected.length} upsell products`);
            } catch (error) {
                console.error('[Cart Drawer] Failed to load random products:', error);
                this.elements.upsellSlider.innerHTML = '<p style="text-align:center;color:var(--ccd-text-muted);">Unable to load recommendations</p>';
            }
        }

        toCents(rawPrice) {
            if (rawPrice == null) return 0;
            const str = String(rawPrice).trim();
            if (str === '') return 0;
            if (str.includes('.')) {
                const dollars = parseFloat(str);
                return Math.round(dollars * 100);
            }
            return parseInt(str, 10) || 0;
        }

        formatMoney(cents) {
            const amount = parseInt(cents);
            if (isNaN(amount) || amount <= 0) return '$0.00';
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
        }

        shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }

        getSlidesPerView() {
            const width = window.innerWidth;
            if (width < 480) return 1;
            if (width < 768) return 2;
            return 3;
        }

        createUpsellDots() {
            const dotsContainer = this.elements.upsellDots;
            if (!dotsContainer) return;
            
            const totalDots = this.sliderTotalSlides;
            dotsContainer.innerHTML = '';
            
            for (let i = 0; i < totalDots; i++) {
                const dot = document.createElement('button');
                dot.className = 'ccd-upsell-dot' + (i === 0 ? ' is-active' : '');
                dot.addEventListener('click', () => {
                    this.sliderCurrentIndex = i;
                    this.updateUpsellSlider();
                });
                dotsContainer.appendChild(dot);
            }
        }

        updateUpsellSlider() {
            const slider = this.elements.upsellSlider;
            if (!slider) return;
            
            const slides = slider.querySelectorAll('.ccd-upsell-slide');
            if (slides.length === 0) return;
            
            const firstSlide = slides[0];
            const slideWidth = firstSlide.offsetWidth;
            const offset = this.sliderCurrentIndex * (slideWidth + this.slideGapPx);
            slider.style.transform = `translateX(-${offset}px)`;

            const dots = document.querySelectorAll('.ccd-upsell-dot');
            dots.forEach((dot, i) => {
                dot.classList.toggle('is-active', i === this.sliderCurrentIndex);
            });

            if (this.elements.upsellPrev) {
                this.elements.upsellPrev.disabled = this.sliderCurrentIndex === 0;
            }
            if (this.elements.upsellNext) {
                this.elements.upsellNext.disabled = this.sliderCurrentIndex >= this.sliderTotalSlides - 1;
            }

            if (this.elements.upsellCounter) {
                this.elements.upsellCounter.textContent = `${this.sliderCurrentIndex + 1}/${this.sliderTotalSlides}`;
            }
        }

        // ===== ITEM HANDLERS =====
        handleRemoveItem(button) {
            const item = button.closest('.ccd-item');
            if (!item) return;
            
            const line = parseInt(item.dataset.line);
            if (!line) return;
            
            if (!confirm('Remove this item?')) return;
            this.updateItemQuantity(line, 0);
        }

        handleQuantityChange(button, delta) {
            const item = button.closest('.ccd-item');
            if (!item) return;
            
            const line = parseInt(item.dataset.line);
            if (!line) return;
            
            const qtyEl = item.querySelector('.ccd-qty__value');
            const currentQty = parseInt(qtyEl?.textContent) || 1;
            const newQty = Math.max(1, currentQty + delta);
            
            if (newQty > this.maxQuantity) {
                this.showError(`Maximum quantity is ${this.maxQuantity}`);
                return;
            }
            
            this.updateItemQuantity(line, newQty);
        }

        async updateItemQuantity(line, quantity) {
            if (this.isUpdating) return;
            this.isUpdating = true;
            
            this.showSkeleton();
            
            const item = this.elements.content?.querySelector(`[data-line="${line}"]`);
            if (item) {
                item.classList.add(CONFIG.updatingClass);
                item.querySelectorAll('button').forEach(btn => btn.disabled = true);
            }
            
            try {
                const cart = await this.changeItem(line, quantity);
                this.cart = cart;
                this.renderCart(cart);
                this.updateCartCount(cart.item_count);
                this.updateShippingBar(cart);
                this.scrollToTop(); // scroll after updating
            } catch (error) {
                this.hideSkeleton();
                this.showError('Failed to update cart. Please try again.');
            } finally {
                this.isUpdating = false;
                if (item) {
                    item.classList.remove(CONFIG.updatingClass);
                    item.querySelectorAll('button').forEach(btn => btn.disabled = false);
                }
            }
        }

        debounceQuantityInput(input) {
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
            }
            this.updateTimeout = setTimeout(() => {
                this.handleQuantityInputChange(input);
                this.updateTimeout = null;
            }, CONFIG.debounceDelay);
        }

        async handleQuantityInputChange(input) {
            const item = input.closest('.ccd-item');
            if (!item) return;
            
            const line = parseInt(item.dataset.line);
            if (!line) return;
            
            let newQty = parseInt(input.value) || 1;
            newQty = Math.max(1, Math.min(newQty, this.maxQuantity));
            
            if (newQty !== parseInt(input.value)) {
                input.value = newQty;
            }
            
            await this.updateItemQuantity(line, newQty);
        }

        async handleUpsellAdd(button) {
            const variantId = parseInt(button.dataset.variantId);
            if (!variantId) return;
            
            button.disabled = true;
            const originalText = button.textContent;
            this.showSkeleton();
            
            try {
                await this.addItem(variantId, 1);
                this.cart = await this.getCart(true);
                this.renderCart(this.cart);
                this.updateCartCount(this.cart.item_count);
                this.scrollToTop(); // scroll after adding
                
                button.textContent = '✓ Added';
                button.style.background = '#2e7d32';
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '';
                    button.disabled = false;
                }, 2000);
            } catch (error) {
                this.hideSkeleton();
                this.showError('Failed to add item');
                button.textContent = originalText;
                button.disabled = false;
            }
        }

        escapeHTML(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        showError(message) {
            const existing = document.querySelector('.ccd-error-toast');
            if (existing) existing.remove();
            
            const toast = document.createElement('div');
            toast.className = 'ccd-error-toast';
            toast.textContent = message;
            toast.style.cssText = `
                position:fixed;
                bottom:80px;
                left:50%;
                transform:translateX(-50%);
                background:#c0392b;
                color:white;
                padding:12px 24px;
                border-radius:8px;
                font-family:inherit;
                font-size:14px;
                z-index:99999;
                box-shadow:0 4px 12px rgba(0,0,0,0.2);
                max-width:90%;
                text-align:center;
                animation:ccdSlideUp 0.3s ease;
            `;
            
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    let cartDrawer;
    
    function initCartDrawer() {
        cartDrawer = new CartDrawer();
        window.cartDrawer = cartDrawer;
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCartDrawer);
    } else {
        initCartDrawer();
    }
})();