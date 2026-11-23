(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* 1. Unified Scroll, Parallax, Hero Scrub, Process Timeline & Mobile Sticky Bar */
  const header = document.getElementById('site-header');
  const scrollProgress = document.getElementById('scroll-progress');
  const nav = document.getElementById('main-nav');
  const navIndicator = document.getElementById('nav-indicator');
  const navLinks = Array.from(document.querySelectorAll('.nav__link'));
  const trackedSections = Array.from(document.querySelectorAll('main > section[id]'));
  const mobileStickyBar = document.getElementById('mobile-sticky-bar');
  const bookingSection = document.getElementById('booking');
  const cookieNotice = document.getElementById('cookie-notice');

  const heroSection = document.getElementById('top');
  const heroWatermark = document.getElementById('hero-watermark');
  const heroSeal = document.getElementById('hero-seal');
  const heroMedia = document.querySelector('.hero__media');

  const processTimeline = document.getElementById('process-timeline');
  const processLineFill = document.getElementById('process-line-fill');
  const processSteps = Array.from(document.querySelectorAll('.process-step'));
  const parallaxImages = Array.from(document.querySelectorAll('[data-parallax-img]'));

  const moveNavIndicator = (targetLink) => {
    if (!navIndicator || !nav) return;
    if (!targetLink) {
      navIndicator.style.opacity = '0';
      return;
    }
    navIndicator.style.width = `${targetLink.offsetWidth}px`;
    navIndicator.style.transform = `translateX(${targetLink.offsetLeft}px)`;
    navIndicator.style.opacity = '1';
  };

  if (nav && navLinks.length > 0) {
    navLinks.forEach((link) => {
      link.addEventListener('mouseenter', () => moveNavIndicator(link));
      link.addEventListener('focus', () => moveNavIndicator(link));
    });
    nav.addEventListener('mouseleave', () => {
      const active = nav.querySelector('.nav__link.is-active');
      moveNavIndicator(active || null);
    });
  }

  let activeSectionId = '';
  let scrollRafPending = false;

  const updateScrollEffects = () => {
    scrollRafPending = false;

    const scrollY = window.scrollY;
    const vh = Math.max(window.innerHeight, 1);
    const maxScroll = Math.max(document.documentElement.scrollHeight - vh, 1);
    const globalProgress = Math.min(Math.max(scrollY / maxScroll, 0), 1);

    // Batch layout reads before DOM writes
    const bookingRect = bookingSection ? bookingSection.getBoundingClientRect() : null;
    const heroHeight = heroSection ? heroSection.offsetHeight : 0;
    const processRect = processTimeline ? processTimeline.getBoundingClientRect() : null;

    let parallaxShifts = null;
    if (finePointer && !prefersReducedMotion && parallaxImages.length > 0) {
      const center = vh * 0.5;
      parallaxShifts = new Array(parallaxImages.length);
      for (let i = 0; i < parallaxImages.length; i++) {
        const rect = parallaxImages[i].getBoundingClientRect();
        if (rect.bottom < -40 || rect.top > vh + 40) {
          parallaxShifts[i] = null;
        } else {
          const imgCenter = rect.top + rect.height * 0.5;
          const norm = Math.max(-1, Math.min(1, (imgCenter - center) / center));
          parallaxShifts[i] = (norm * -14).toFixed(2);
        }
      }
    }

    let nextActiveId = '';
    if (scrollY >= 140) {
      const marker = scrollY + Math.min(vh * 0.34, 280);
      for (let i = 0; i < trackedSections.length; i++) {
        const sec = trackedSections[i];
        const top = sec.offsetTop;
        const bottom = top + sec.offsetHeight;
        if (marker >= top && marker < bottom) {
          nextActiveId = sec.id;
          break;
        }
      }
    }

    // Batch DOM writes
    if (scrollProgress) {
      scrollProgress.style.transform = `scaleX(${globalProgress.toFixed(4)})`;
    }

    if (header) {
      header.classList.toggle('is-scrolled', scrollY > 24);
    }

    if (nextActiveId !== activeSectionId) {
      activeSectionId = nextActiveId;
      let activeLink = null;
      navLinks.forEach((link) => {
        const hrefId = (link.getAttribute('href') || '').replace('#', '');
        const match = Boolean(activeSectionId && hrefId === activeSectionId);
        link.classList.toggle('is-active', match);
        if (match) activeLink = link;
      });
      if (!nav?.matches(':hover')) {
        moveNavIndicator(activeLink);
      }
    }

    if (!prefersReducedMotion && heroSection && heroHeight > 0 && scrollY <= heroHeight + 160) {
      const ratio = Math.min(Math.max(scrollY / heroHeight, 0), 1);
      if (heroWatermark) {
        heroWatermark.style.setProperty('--wm-x', `${(ratio * -36).toFixed(1)}px`);
        heroWatermark.style.setProperty('--wm-y', `${(ratio * 28).toFixed(1)}px`);
      }
      if (heroMedia && window.innerWidth >= 1024) {
        heroMedia.style.setProperty('--hero-shift', `${(ratio * 26).toFixed(1)}px`);
        heroMedia.style.setProperty('--hero-scale', `${(1 + ratio * 0.045).toFixed(4)}`);
      }
      if (heroSeal) {
        heroSeal.style.setProperty('--seal-rot', `${(scrollY * 0.14).toFixed(1)}deg`);
      }
    } else if (prefersReducedMotion && heroMedia) {
      heroMedia.style.removeProperty('--hero-shift');
      heroMedia.style.removeProperty('--hero-scale');
    }

    if (processTimeline && processLineFill && processRect) {
      if (prefersReducedMotion) {
        processLineFill.style.setProperty('--progress', '1');
        processSteps.forEach((step) => step.classList.add('is-active'));
      } else {
        const startY = vh * 0.84;
        const endY = vh * 0.34;
        const p = Math.min(Math.max((startY - processRect.top) / Math.max(startY - endY, 1), 0), 1);
        processLineFill.style.setProperty('--progress', p.toFixed(4));
        processSteps.forEach((step, idx) => {
          const threshold = idx === 0 ? 0 : idx / Math.max(processSteps.length - 1, 1) - 0.08;
          step.classList.toggle('is-active', p >= threshold);
        });
      }
    }

    if (parallaxShifts) {
      for (let i = 0; i < parallaxImages.length; i++) {
        if (parallaxShifts[i] !== null) {
          parallaxImages[i].style.setProperty('--py', `${parallaxShifts[i]}px`);
        }
      }
    }

    if (mobileStickyBar) {
      const drawerOpen = document.body.classList.contains('nav-locked');
      const modalOpen = document.body.classList.contains('modal-locked');
      const cookieOpen = Boolean(
        cookieNotice && !cookieNotice.hidden && cookieNotice.classList.contains('is-visible')
      );
      const bookingInView = Boolean(
        bookingRect && bookingRect.top < vh * 0.72 && bookingRect.bottom > 120
      );
      const showBar = scrollY > 360 && !bookingInView && !drawerOpen && !modalOpen && !cookieOpen;
      mobileStickyBar.classList.toggle('is-visible', showBar);
      mobileStickyBar.setAttribute('aria-hidden', String(!showBar));
    }
  };

  const scheduleScrollUpdate = () => {
    if (!scrollRafPending) {
      scrollRafPending = true;
      requestAnimationFrame(updateScrollEffects);
    }
  };

  window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
  window.addEventListener('resize', () => {
    const active = nav?.querySelector('.nav__link.is-active');
    moveNavIndicator(active || null);
    scheduleScrollUpdate();
  }, { passive: true });
  updateScrollEffects();

  /* 2. Mobile Drawer & Burger Menu */
  const burgerBtn = document.getElementById('burger-btn');
  const drawer = document.getElementById('mobile-drawer');
  const drawerClose = document.getElementById('drawer-close');
  let drawerTimer = null;

  const openDrawer = () => {
    if (!drawer || !burgerBtn) return;
    if (drawerTimer) clearTimeout(drawerTimer);
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    burgerBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-locked');
    updateScrollEffects();
    requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      drawerClose?.focus();
    });
  };

  const closeDrawer = ({ restoreFocus = true } = {}) => {
    if (!drawer || !burgerBtn || drawer.hidden) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    burgerBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-locked');
    updateScrollEffects();
    drawerTimer = setTimeout(() => {
      drawer.hidden = true;
      if (restoreFocus) burgerBtn.focus();
    }, 280);
  };

  burgerBtn?.addEventListener('click', () => {
    const expanded = burgerBtn.getAttribute('aria-expanded') === 'true';
    if (expanded) closeDrawer();
    else openDrawer();
  });

  drawerClose?.addEventListener('click', () => closeDrawer());
  drawer?.querySelectorAll('[data-drawer-close]').forEach((el) => {
    el.addEventListener('click', () => closeDrawer({ restoreFocus: false }));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && !drawer.hidden) {
      closeDrawer();
    }
  });

  /* 3. Subtle Magnetic Pill CTA Pull */
  if (finePointer && !prefersReducedMotion) {
    document.querySelectorAll('[data-magnetic]').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const normX = (e.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
        const normY = (e.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
        const shiftX = Math.max(-3, Math.min(3, normX * 6));
        const shiftY = Math.max(-3, Math.min(3, normY * 6));
        btn.style.setProperty('--tx', `${shiftX.toFixed(1)}px`);
        btn.style.setProperty('--ty', `${shiftY.toFixed(1)}px`);
      });

      const resetMagnet = () => {
        btn.style.setProperty('--tx', '0px');
        btn.style.setProperty('--ty', '0px');
      };

      btn.addEventListener('mouseleave', resetMagnet);
      btn.addEventListener('blur', resetMagnet);
    });
  }

  /* 4. Services Hybrid Controller (Direction Cards + Pill Tabs + Live Search) */
  const directionCards = Array.from(document.querySelectorAll('[data-direction-filter]'));
  const catalogEl = document.getElementById('catalog');
  const tabsBar = document.getElementById('tabs-bar');
  const tabsViewport = document.getElementById('tabs-viewport');
  const tabsPrevBtn = document.getElementById('tabs-prev');
  const tabsNextBtn = document.getElementById('tabs-next');
  const tabList = document.getElementById('service-tabs');
  const tabs = tabList ? Array.from(tabList.querySelectorAll('.tab')) : [];
  const tabsSlider = tabList ? tabList.querySelector('.tabs__slider') : null;
  const searchInput = document.getElementById('service-search');
  const searchClearBtn = document.getElementById('service-search-clear');
  const catalogStatus = document.getElementById('catalog-status');
  const serviceCards = Array.from(document.querySelectorAll('#services-grid .service-card'));
  const servicesEmpty = document.getElementById('services-empty');
  const servicesResetBtn = document.getElementById('services-search-reset');

  let activeFilter = 'popular';

  const moveTabsSlider = (tabEl) => {
    if (!tabsSlider || !tabEl) return;
    tabsSlider.style.width = `${tabEl.offsetWidth}px`;
    tabsSlider.style.transform = `translateX(${tabEl.offsetLeft}px)`;
  };

  const syncTabsScrollUI = () => {
    if (!tabList || !tabsBar) return;
    const isOverflowing = tabList.scrollWidth > tabList.clientWidth + 2;
    tabsBar.classList.toggle('is-overflowing', isOverflowing);

    if (tabsViewport) {
      tabsViewport.classList.toggle('can-scroll-left', isOverflowing && tabList.scrollLeft > 4);
      tabsViewport.classList.toggle(
        'can-scroll-right',
        isOverflowing && tabList.scrollLeft + tabList.clientWidth < tabList.scrollWidth - 4
      );
    }

    const activeIdx = tabs.findIndex((t) => t.classList.contains('is-active'));
    if (tabsPrevBtn) tabsPrevBtn.disabled = activeIdx <= 0;
    if (tabsNextBtn) tabsNextBtn.disabled = activeIdx < 0 || activeIdx >= tabs.length - 1;
  };

  const renderServicesCatalog = () => {
    const query = (searchInput?.value || '').trim().toLowerCase();
    const isSearching = query.length > 0;

    if (tabList) tabList.classList.toggle('is-searching', isSearching);
    if (searchClearBtn) searchClearBtn.hidden = !isSearching;

    let visibleCount = 0;
    const entering = [];

    serviceCards.forEach((card) => {
      card.classList.remove('is-entering');
      let match = false;
      if (isSearching) {
        const haystack = (
          card.dataset.searchText ||
          `${card.querySelector('.service-card__title')?.textContent || ''} ${card.querySelector('.service-card__desc')?.textContent || ''}`
        ).toLowerCase();
        match = haystack.includes(query);
      } else {
        match =
          activeFilter === 'popular'
            ? card.dataset.popular === 'true'
            : card.dataset.category === activeFilter;
      }

      card.hidden = !match;
      if (match) {
        card.style.setProperty('--stagger', String(visibleCount));
        entering.push(card);
        visibleCount += 1;
      }
    });

    if (catalogStatus) {
      if (isSearching) {
        catalogStatus.hidden = false;
        catalogStatus.textContent = `Найдено процедур: ${visibleCount}`;
      } else {
        catalogStatus.hidden = true;
        catalogStatus.textContent = '';
      }
    }

    if (servicesEmpty) {
      servicesEmpty.hidden = visibleCount > 0;
    }

    if (!prefersReducedMotion && entering.length > 0) {
      requestAnimationFrame(() => {
        entering.forEach((card) => card.classList.add('is-entering'));
      });
    }
  };

  const activateTab = (tabEl, { moveFocus = false, clearSearch = false } = {}) => {
    if (!tabEl) return;
    if (clearSearch && searchInput && searchInput.value) {
      searchInput.value = '';
    }
    activeFilter = tabEl.dataset.filter || 'popular';
    tabs.forEach((t) => {
      const active = t === tabEl;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
      t.setAttribute('tabindex', active ? '0' : '-1');
    });
    moveTabsSlider(tabEl);
    tabEl.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
    syncTabsScrollUI();
    requestAnimationFrame(() => {
      syncTabsScrollUI();
      moveTabsSlider(tabEl);
    });
    renderServicesCatalog();
    if (moveFocus) tabEl.focus();
  };

  if (tabs.length > 0) {
    const initialTab = tabs.find((t) => t.classList.contains('is-active')) || tabs[0];
    requestAnimationFrame(() => {
      syncTabsScrollUI();
      moveTabsSlider(initialTab);
      requestAnimationFrame(() => {
        syncTabsScrollUI();
        moveTabsSlider(initialTab);
      });
    });

    document.fonts?.ready?.then(() => {
      syncTabsScrollUI();
      const current = tabs.find((t) => t.classList.contains('is-active'));
      if (current) moveTabsSlider(current);
    });

    tabList?.addEventListener('scroll', syncTabsScrollUI, { passive: true });
    window.addEventListener('resize', () => {
      syncTabsScrollUI();
      const current = tabs.find((t) => t.classList.contains('is-active'));
      if (current) moveTabsSlider(current);
    }, { passive: true });

    tabsPrevBtn?.addEventListener('click', () => {
      const currentIdx = tabs.findIndex((t) => t.classList.contains('is-active'));
      if (currentIdx > 0) activateTab(tabs[currentIdx - 1], { clearSearch: true });
    });

    tabsNextBtn?.addEventListener('click', () => {
      const currentIdx = tabs.findIndex((t) => t.classList.contains('is-active'));
      if (currentIdx >= 0 && currentIdx < tabs.length - 1) activateTab(tabs[currentIdx + 1], { clearSearch: true });
    });

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tab, { clearSearch: true }));
      tab.addEventListener('keydown', (e) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIndex = 0;
        else if (e.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex >= 0) {
          e.preventDefault();
          activateTab(tabs[nextIndex], { moveFocus: true, clearSearch: true });
        }
      });
    });
  }

  directionCards.forEach((card) => {
    card.addEventListener('click', () => {
      const filterKey = card.dataset.directionFilter || 'popular';
      const targetTab = tabs.find((t) => t.dataset.filter === filterKey) || tabs[0];
      if (targetTab) activateTab(targetTab, { clearSearch: true });
      catalogEl?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  });

  searchInput?.addEventListener('input', renderServicesCatalog);

  const resetCatalogSearch = () => {
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    renderServicesCatalog();
  };

  searchClearBtn?.addEventListener('click', resetCatalogSearch);
  servicesResetBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    const popularTab = tabs.find((t) => t.dataset.filter === 'popular') || tabs[0];
    if (popularTab) activateTab(popularTab);
    else renderServicesCatalog();
  });

  /* 5. Client Reviews Carousel */
  const reviewsTrack = document.getElementById('reviews-track');
  const reviewsPrev = document.getElementById('reviews-prev');
  const reviewsNext = document.getElementById('reviews-next');
  const reviewsDots = document.getElementById('reviews-dots');
  const reviewCards = reviewsTrack ? Array.from(reviewsTrack.querySelectorAll('.review-card')) : [];

  if (reviewsTrack && reviewCards.length > 0) {
    let perPage = 3;
    let totalPages = 2;
    let currentPage = 0;

    const getPerPage = () => {
      const w = window.innerWidth;
      if (w >= 1024) return 3;
      if (w >= 640) return 2;
      return 1;
    };

    const renderDots = () => {
      if (!reviewsDots) return;
      reviewsDots.innerHTML = '';
      for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `carousel-dot${i === currentPage ? ' is-active' : ''}`;
        dot.setAttribute('aria-label', `Страница отзывов ${i + 1}`);
        dot.setAttribute('aria-pressed', String(i === currentPage));
        dot.addEventListener('click', () => goToReviewPage(i));
        reviewsDots.appendChild(dot);
      }
    };

    const updateCarouselPosition = () => {
      const gap = 20;
      const cardWidth = reviewCards[0].getBoundingClientRect().width;
      const startIndex = Math.min(currentPage * perPage, Math.max(0, reviewCards.length - perPage));
      const offset = startIndex * (cardWidth + gap);
      reviewsTrack.style.transform = `translate3d(-${offset.toFixed(1)}px, 0, 0)`;

      if (reviewsPrev) reviewsPrev.disabled = currentPage <= 0;
      if (reviewsNext) reviewsNext.disabled = currentPage >= totalPages - 1;

      if (reviewsDots) {
        Array.from(reviewsDots.children).forEach((dot, idx) => {
          const active = idx === currentPage;
          dot.classList.toggle('is-active', active);
          dot.setAttribute('aria-pressed', String(active));
        });
      }
    };

    const goToReviewPage = (nextPage) => {
      currentPage = Math.max(0, Math.min(nextPage, totalPages - 1));
      updateCarouselPosition();
    };

    const syncCarouselLayout = () => {
      perPage = getPerPage();
      totalPages = Math.max(1, Math.ceil(reviewCards.length / perPage));
      reviewsTrack.style.setProperty('--per-page', String(perPage));
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      renderDots();
      requestAnimationFrame(updateCarouselPosition);
    };

    reviewsPrev?.addEventListener('click', () => goToReviewPage(currentPage - 1));
    reviewsNext?.addEventListener('click', () => goToReviewPage(currentPage + 1));

    let pointerStartX = null;
    reviewsTrack.addEventListener('pointerdown', (e) => {
      pointerStartX = e.clientX;
    });
    reviewsTrack.addEventListener('pointerup', (e) => {
      if (pointerStartX === null) return;
      const deltaX = e.clientX - pointerStartX;
      pointerStartX = null;
      if (Math.abs(deltaX) > 40) {
        if (deltaX < 0) goToReviewPage(currentPage + 1);
        else goToReviewPage(currentPage - 1);
      }
    });
    reviewsTrack.addEventListener('pointercancel', () => {
      pointerStartX = null;
    });

    window.addEventListener('resize', syncCarouselLayout, { passive: true });
    syncCarouselLayout();
  }

  /* 6. Gallery & About Editorial Lightbox */
  const lightbox = document.getElementById('lightbox');
  const lightboxTriggers = Array.from(document.querySelectorAll('[data-lightbox-src]'));
  const lbMedia = lightbox ? lightbox.querySelector('.lightbox__media') : null;
  const lbBar = lightbox ? lightbox.querySelector('.lightbox__bar') : null;
  const lbImg = document.getElementById('lightbox-img');
  const lbCounter = document.getElementById('lightbox-counter');
  const lbTitle = document.getElementById('lightbox-title');
  const lbMeta = document.getElementById('lightbox-meta');
  const lbBook = document.getElementById('lightbox-book');
  const lbPrev = document.getElementById('lightbox-prev');
  const lbNext = document.getElementById('lightbox-next');
  const lbClose = document.getElementById('lightbox-close');
  let lbIndex = 0;
  let lbTransitionId = 0;

  const preloadLightboxSrc = (src) => {
    if (!src) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const timer = setTimeout(finish, 1500);
      const settle = () => {
        clearTimeout(timer);
        finish();
      };
      const img = new Image();
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => {}).finally(settle);
        } else {
          settle();
        }
      };
      img.onerror = settle;
      img.src = src;
      if (img.complete) {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => {}).finally(settle);
        } else {
          settle();
        }
      }
    });
  };

  const clearLightboxTransitionClasses = () => {
    lbImg?.classList.remove(
      'is-exiting-next',
      'is-exiting-prev',
      'is-entering-next',
      'is-entering-prev'
    );
    lbBar?.classList.remove('is-swapping');
  };

  const preloadAdjacentLightboxImages = (index) => {
    if (lightboxTriggers.length <= 1) return;
    const prevIdx = ((index - 1) % lightboxTriggers.length + lightboxTriggers.length) % lightboxTriggers.length;
    const nextIdx = (index + 1) % lightboxTriggers.length;
    const prevSrc = lightboxTriggers[prevIdx]?.dataset.lightboxSrc;
    const nextSrc = lightboxTriggers[nextIdx]?.dataset.lightboxSrc;
    if (prevSrc) {
      const img = new Image();
      img.src = prevSrc;
    }
    if (nextSrc) {
      const img = new Image();
      img.src = nextSrc;
    }
  };

  const applyLightboxContent = (item, targetIdx) => {
    const src = item.dataset.lightboxSrc || '';
    const title = item.dataset.lightboxTitle || '';
    const meta = item.dataset.lightboxMeta || '';
    const service = item.dataset.lightboxService || '';

    if (lbImg) {
      lbImg.setAttribute('src', src);
      lbImg.setAttribute('alt', title);
    }
    if (lbCounter) lbCounter.textContent = `${targetIdx + 1} / ${lightboxTriggers.length}`;
    if (lbTitle) lbTitle.textContent = title;
    if (lbMeta) lbMeta.textContent = meta;
    if (lbBook) {
      lbBook.hidden = !service;
      lbBook.dataset.selectedService = service;
    }
  };

  const renderLightbox = (index, { direction = 0, animate = false } = {}) => {
    if (lightboxTriggers.length === 0) return;
    lbIndex = ((index % lightboxTriggers.length) + lightboxTriggers.length) % lightboxTriggers.length;
    const item = lightboxTriggers[lbIndex];
    const src = item.dataset.lightboxSrc || '';
    const token = ++lbTransitionId;

    preloadAdjacentLightboxImages(lbIndex);

    if (!animate || prefersReducedMotion || direction === 0 || !lbImg) {
      clearLightboxTransitionClasses();
      applyLightboxContent(item, lbIndex);
      return;
    }

    const exitClass = direction > 0 ? 'is-exiting-next' : 'is-exiting-prev';
    const enterClass = direction > 0 ? 'is-entering-next' : 'is-entering-prev';

    clearLightboxTransitionClasses();
    lbImg.classList.add(exitClass);
    lbBar?.classList.add('is-swapping');

    const minDelay = new Promise((resolve) => setTimeout(resolve, 140));

    Promise.all([minDelay, preloadLightboxSrc(src)]).then(() => {
      if (token !== lbTransitionId) return;

      lbImg.classList.remove(exitClass);
      lbImg.classList.add(enterClass);
      applyLightboxContent(item, lbIndex);
      void lbImg.offsetWidth;

      requestAnimationFrame(() => {
        if (token !== lbTransitionId) return;
        lbImg.classList.remove(enterClass);
        lbBar?.classList.remove('is-swapping');
      });
    });
  };

  const openLightboxAt = (index) => {
    if (!lightbox || typeof lightbox.showModal !== 'function') return;
    renderLightbox(index);
    document.body.classList.add('modal-locked');
    lightbox.showModal();
    updateScrollEffects();
  };

  lightboxTriggers.forEach((trigger, index) => {
    trigger.addEventListener('click', () => openLightboxAt(index));
  });

  document.querySelectorAll('[data-lightbox-open-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.lightboxOpenIndex || '0', 10);
      openLightboxAt(Number.isNaN(idx) ? 0 : idx);
    });
  });

  lbPrev?.addEventListener('click', () => renderLightbox(lbIndex - 1, { direction: -1, animate: true }));
  lbNext?.addEventListener('click', () => renderLightbox(lbIndex + 1, { direction: 1, animate: true }));
  lbClose?.addEventListener('click', () => lightbox?.close());

  if (lbMedia) {
    let lbSwipeStartX = null;
    lbMedia.addEventListener('pointerdown', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      lbSwipeStartX = e.clientX;
    });
    lbMedia.addEventListener('pointerup', (e) => {
      if (lbSwipeStartX === null) return;
      const deltaX = e.clientX - lbSwipeStartX;
      lbSwipeStartX = null;
      if (Math.abs(deltaX) > 45) {
        if (deltaX < 0) renderLightbox(lbIndex + 1, { direction: 1, animate: true });
        else renderLightbox(lbIndex - 1, { direction: -1, animate: true });
      }
    });
    lbMedia.addEventListener('pointercancel', () => {
      lbSwipeStartX = null;
    });
  }

  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.close();
  });

  lightbox?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      renderLightbox(lbIndex - 1, { direction: -1, animate: true });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      renderLightbox(lbIndex + 1, { direction: 1, animate: true });
    }
  });

  lightbox?.addEventListener('close', () => {
    lbTransitionId += 1;
    clearLightboxTransitionClasses();
    document.body.classList.remove('modal-locked');
    updateScrollEffects();
  });

  /* 7. Click-to-Load Interactive Yandex Map */
  const loadMapBtn = document.getElementById('load-yandex-map');
  const mapMount = document.getElementById('yandex-map-mount');
  const mapOverlay = document.getElementById('map-overlay');

  loadMapBtn?.addEventListener('click', () => {
    if (!mapMount) return;
    if (!mapMount.querySelector('iframe')) {
      const iframe = document.createElement('iframe');
      iframe.title = 'Интерактивная карта проезда — Maison Éclat, ул. Советская, 18, Новосибирск';
      iframe.src = 'https://yandex.ru/map-widget/v1/?ll=82.918200%2C55.028900&z=16&pt=82.918200,55.028900,pm2orgm';
      iframe.loading = 'eager';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      mapMount.appendChild(iframe);
    }
    mapMount.hidden = false;
    if (mapOverlay) mapOverlay.hidden = true;
  });

  /* 8. Unified Legal Modal & Cookie Consent */
  const COOKIE_KEY = 'me_cookie_consent_v1';
  const privacyModal = document.getElementById('privacy-modal');
  const privacyClose = document.getElementById('privacy-close');
  const legalTabs = Array.from(document.querySelectorAll('[data-legal-tab]'));
  const legalPanels = Array.from(document.querySelectorAll('[data-legal-panel]'));
  const cookieAcceptAll = document.getElementById('cookie-accept-all');
  const cookieEssential = document.getElementById('cookie-essential');
  const cookieStatusLabel = document.getElementById('cookie-status-label');
  const cookieResetBtn = document.getElementById('cookie-reset-choice');
  let cookieTimer = null;

  const readCookieChoice = () => {
    try {
      const val = window.localStorage.getItem(COOKIE_KEY);
      return val === 'all' || val === 'essential' ? val : null;
    } catch {
      return null;
    }
  };

  const writeCookieChoice = (val) => {
    try {
      if (val) window.localStorage.setItem(COOKIE_KEY, val);
      else window.localStorage.removeItem(COOKIE_KEY);
    } catch {
      // Ignore storage restrictions in private mode
    }
  };

  const updateCookieStatusLabel = (choice) => {
    if (!cookieStatusLabel) return;
    if (choice === 'all') {
      cookieStatusLabel.textContent = 'Приняты все файлы cookie (технические и аналитические).';
    } else if (choice === 'essential') {
      cookieStatusLabel.textContent = 'Разрешены только необходимые технические cookie.';
    } else {
      cookieStatusLabel.textContent = 'Выбор ещё не сохранён.';
    }
  };

  const showCookieNotice = () => {
    if (!cookieNotice) return;
    if (cookieTimer) {
      clearTimeout(cookieTimer);
      cookieTimer = null;
    }
    cookieNotice.hidden = false;
    requestAnimationFrame(() => {
      cookieNotice.classList.add('is-visible');
      updateScrollEffects();
    });
  };

  const dismissCookieNotice = (choice) => {
    if (!cookieNotice) return;
    if (cookieTimer) {
      clearTimeout(cookieTimer);
      cookieTimer = null;
    }
    writeCookieChoice(choice);
    updateCookieStatusLabel(choice);
    cookieNotice.classList.remove('is-visible');
    updateScrollEffects();
    cookieTimer = setTimeout(() => {
      cookieNotice.hidden = true;
      updateScrollEffects();
    }, 260);
  };

  const initialCookieChoice = readCookieChoice();
  updateCookieStatusLabel(initialCookieChoice);
  if (!initialCookieChoice && cookieNotice) {
    cookieTimer = setTimeout(showCookieNotice, 900);
  }

  cookieAcceptAll?.addEventListener('click', () => dismissCookieNotice('all'));
  cookieEssential?.addEventListener('click', () => dismissCookieNotice('essential'));

  const activateLegalTab = (tabKey, { moveFocus = false } = {}) => {
    if (legalTabs.length === 0) return;
    const matched = legalTabs.find((t) => t.dataset.legalTab === tabKey) || legalTabs[0];
    const resolvedKey = matched.dataset.legalTab || 'privacy';

    legalTabs.forEach((tab) => {
      const active = tab === matched;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    });

    legalPanels.forEach((panel) => {
      panel.hidden = panel.dataset.legalPanel !== resolvedKey;
    });

    if (moveFocus) matched.focus();
  };

  legalTabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activateLegalTab(tab.dataset.legalTab || 'privacy'));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % legalTabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + legalTabs.length) % legalTabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = legalTabs.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        const targetTab = legalTabs[nextIdx];
        activateLegalTab(targetTab.dataset.legalTab || 'privacy', { moveFocus: true });
      }
    });
  });

  const openLegalModal = (tabKey = 'privacy') => {
    if (!privacyModal || typeof privacyModal.showModal !== 'function') return;
    activateLegalTab(tabKey);
    document.body.classList.add('modal-locked');
    privacyModal.showModal();
    updateScrollEffects();
  };

  document.querySelectorAll('[data-legal-open]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openLegalModal(btn.dataset.legalOpen || 'privacy');
    });
  });

  cookieResetBtn?.addEventListener('click', () => {
    writeCookieChoice(null);
    updateCookieStatusLabel(null);
    privacyModal?.close();
    showCookieNotice();
  });

  privacyClose?.addEventListener('click', () => privacyModal?.close());
  privacyModal?.addEventListener('click', (e) => {
    if (e.target === privacyModal) privacyModal.close();
  });
  privacyModal?.addEventListener('close', () => {
    document.body.classList.remove('modal-locked');
    updateScrollEffects();
  });

  /* 9. Lightweight Booking Form, Phone Mask, Promo Banner Hook & /api/booking */
  const bookingForm = document.getElementById('booking-form');
  const bookingSuccess = document.getElementById('booking-success');
  const bookingAlert = document.getElementById('booking-alert');
  const bookingSubmit = document.getElementById('booking-submit');
  const bookingReset = document.getElementById('booking-reset');
  const offerCtaBtn = document.getElementById('offer-cta-btn');

  const nameInput = document.getElementById('field-name');
  const phoneInput = document.getElementById('field-phone');
  const serviceSelect = document.getElementById('field-service');
  const masterSelect = document.getElementById('field-master');
  const promoCheckbox = document.getElementById('field-promo');
  const consentCheckbox = document.getElementById('field-consent');
  const companyHoneypot = document.getElementById('field-company');

  const formatRuPhone = (raw) => {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits[0] === '8' || digits[0] === '7') digits = `7${digits.slice(1)}`;
    else digits = `7${digits}`;
    digits = digits.slice(0, 11);

    if (digits.length === 1) return '+7';
    let out = `+7 (${digits.slice(1, 4)}`;
    if (digits.length > 4) out += `) ${digits.slice(4, 7)}`;
    if (digits.length > 7) out += `-${digits.slice(7, 9)}`;
    if (digits.length > 9) out += `-${digits.slice(9, 11)}`;
    return out;
  };

  const setFieldError = (controlEl, errorId, message) => {
    const field = controlEl?.closest('.field');
    const errEl = document.getElementById(errorId);
    if (field) field.classList.toggle('is-invalid', Boolean(message));
    if (controlEl && typeof controlEl.setAttribute === 'function') {
      controlEl.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    if (errEl) errEl.textContent = message;
  };

  const showFormAlert = (message) => {
    if (!bookingAlert) return;
    bookingAlert.textContent = message;
    bookingAlert.hidden = !message;
  };

  phoneInput?.addEventListener('input', () => {
    phoneInput.value = formatRuPhone(phoneInput.value);
  });

  const scrollToBookingWith = ({ service, promo } = {}) => {
    if (service && serviceSelect) {
      const hasOption = Array.from(serviceSelect.options).some((opt) => opt.value === service);
      if (hasOption) {
        serviceSelect.value = service;
        setFieldError(serviceSelect, 'error-service', '');
      }
    }

    if (typeof promo === 'boolean' && promoCheckbox) {
      promoCheckbox.checked = promo;
    }

    if (bookingSuccess && !bookingSuccess.hidden) {
      bookingSuccess.hidden = true;
      if (bookingForm) bookingForm.hidden = false;
    }

    bookingSection?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    setTimeout(() => {
      nameInput?.focus({ preventScroll: true });
    }, 320);
  };

  document.querySelectorAll('[data-book-service]').forEach((btn) => {
    btn.addEventListener('click', () => {
      scrollToBookingWith({ service: btn.dataset.bookService });
    });
  });

  offerCtaBtn?.addEventListener('click', () => {
    scrollToBookingWith({ promo: true });
  });

  lbBook?.addEventListener('click', () => {
    const service = lbBook.dataset.selectedService || '';
    lightbox?.close();
    scrollToBookingWith({ service });
  });

  if (bookingForm && bookingSuccess) {
    bookingForm.querySelectorAll('input, select').forEach((ctrl) => {
      const evt = ctrl.tagName === 'SELECT' || ctrl.type === 'checkbox' ? 'change' : 'input';
      ctrl.addEventListener(evt, () => {
        if (ctrl.name) setFieldError(ctrl, `error-${ctrl.name}`, '');
        showFormAlert('');
      });
    });

    const renderBookingConfirmation = (payload, response) => {
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setTxt('success-id', response.bookingId || 'ME-1042');
      setTxt('success-name', payload.name);
      setTxt('success-phone', payload.phone);
      setTxt('success-service', payload.service || 'Подбор на консультации');
      setTxt('success-master', payload.master || 'Любой свободный мастер');

      const modeNote = document.getElementById('success-mode-note');
      if (modeNote) {
        modeNote.textContent =
          response.mode === 'telegram'
            ? 'Заявка мгновенно передана администратору и мастерам в Telegram. Перезвоним в ближайшее рабочее время.'
            : 'Заявка зафиксирована в демонстрационном режиме (для живой отправки в Telegram добавьте переменные на Vercel).';
      }

      const promoRow = document.getElementById('success-promo-row');
      if (promoRow) promoRow.hidden = !payload.promo;

      bookingForm.hidden = true;
      bookingSuccess.hidden = false;
      bookingSuccess.focus();
    };

    bookingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showFormAlert('');

      const nameVal = nameInput?.value.trim() || '';
      const phoneVal = phoneInput?.value.trim() || '';
      const phoneDigits = phoneVal.replace(/\D/g, '');
      const serviceVal = serviceSelect?.value.trim() || '';
      const masterVal = masterSelect?.value.trim() || 'Любой свободный мастер';
      const promoVal = Boolean(promoCheckbox?.checked);
      const consentVal = Boolean(consentCheckbox?.checked);
      const companyVal = companyHoneypot?.value.trim() || '';

      let firstInvalid = null;
      const markError = (ctrl, errorId, msg) => {
        setFieldError(ctrl, errorId, msg);
        if (!firstInvalid && ctrl) firstInvalid = ctrl;
      };

      if (nameVal.length < 2) {
        markError(nameInput, 'error-name', 'Укажите ваше имя (минимум 2 символа)');
      }
      if (phoneDigits.length !== 11 || (phoneDigits[0] !== '7' && phoneDigits[0] !== '8')) {
        markError(phoneInput, 'error-phone', 'Введите корректный российский номер телефона');
      }
      if (!consentVal) {
        markError(consentCheckbox, 'error-consent', 'Подтвердите согласие на обработку данных');
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const payload = {
        name: nameVal,
        phone: phoneVal,
        service: serviceVal,
        master: masterVal,
        promo: promoVal,
        consent: consentVal,
        company: companyVal,
      };

      if (bookingSubmit) {
        bookingSubmit.disabled = true;
        bookingSubmit.classList.add('is-loading');
        const label = bookingSubmit.querySelector('.btn__label');
        if (label) label.textContent = 'Отправляем…';
      }

      const isLocalPreview =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.protocol === 'file:';

      try {
        const res = await fetch('/api/booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (isLocalPreview && (res.status === 404 || res.status === 405 || res.status === 501)) {
          renderBookingConfirmation(payload, {
            ok: true,
            mode: 'demo',
            bookingId: `ME-${Math.floor(1000 + Math.random() * 9000)}`,
          });
          return;
        }

        const data = await res.json().catch(() => null);

        if (!res.ok || !data || data.ok !== true) {
          if (res.status === 400 && data?.fields && typeof data.fields === 'object') {
            const fieldMap = {
              name: nameInput,
              phone: phoneInput,
              service: serviceSelect,
              master: masterSelect,
              consent: consentCheckbox,
            };
            let focusTarget = null;
            Object.entries(data.fields).forEach(([key, msg]) => {
              const ctrl = fieldMap[key];
              if (ctrl && typeof msg === 'string') {
                setFieldError(ctrl, `error-${key}`, msg);
                if (!focusTarget) focusTarget = ctrl;
              }
            });
            focusTarget?.focus();
          }
          showFormAlert(
            data?.error || 'Не удалось отправить заявку. Позвоните нам по номеру +7 (383) 209-48-15.'
          );
          return;
        }

        renderBookingConfirmation(payload, data);
      } catch {
        if (isLocalPreview) {
          renderBookingConfirmation(payload, {
            ok: true,
            mode: 'demo',
            bookingId: `ME-${Math.floor(1000 + Math.random() * 9000)}`,
          });
        } else {
          showFormAlert('Ошибка соединения. Попробуйте ещё раз или позвоните +7 (383) 209-48-15.');
        }
      } finally {
        if (bookingSubmit) {
          bookingSubmit.disabled = false;
          bookingSubmit.classList.remove('is-loading');
          const label = bookingSubmit.querySelector('.btn__label');
          if (label) label.textContent = 'Отправить заявку';
        }
      }
    });

    bookingReset?.addEventListener('click', () => {
      bookingForm.reset();
      showFormAlert('');
      bookingForm.querySelectorAll('.field').forEach((f) => f.classList.remove('is-invalid'));
      bookingForm.querySelectorAll('.field__error').forEach((e) => {
        e.textContent = '';
      });
      bookingForm.querySelectorAll('[aria-invalid]').forEach((el) => {
        el.setAttribute('aria-invalid', 'false');
      });
      bookingSuccess.hidden = true;
      bookingForm.hidden = false;
      nameInput?.focus();
    });
  }

  /* 10. Snappy Scroll Reveal & Count-Up Metrics */
  const animateCountUp = (el) => {
    if (!el || el.dataset.counted === 'true') return;
    el.dataset.counted = 'true';
    const target = parseFloat(el.dataset.countTo || '0');
    const decimals = parseInt(el.dataset.countDecimals || '0', 10);
    const suffix = el.dataset.countSuffix || '';
    const formatValue = (val) =>
      `${decimals > 0 ? val.toFixed(decimals) : String(Math.round(val))}${suffix}`;

    if (Number.isNaN(target) || prefersReducedMotion) {
      el.textContent = formatValue(target);
      return;
    }

    const duration = 600;
    const startTime = performance.now();
    const tickCount = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = formatValue(target * eased);
      if (progress < 1) {
        requestAnimationFrame(tickCount);
      } else {
        el.textContent = formatValue(target);
      }
    };
    requestAnimationFrame(tickCount);
  };

  document.querySelectorAll('[data-reveal="stagger"]').forEach((group) => {
    Array.from(group.children).forEach((child, idx) => {
      if (child instanceof HTMLElement) {
        child.style.setProperty('--stagger', String(idx));
      }
    });
  });

  const revealTargets = Array.from(document.querySelectorAll('[data-reveal]'));
  const triggerRevealElement = (el) => {
    el.classList.add('is-revealed');
    if (el.hasAttribute('data-count-to')) animateCountUp(el);
    el.querySelectorAll('[data-count-to]').forEach(animateCountUp);
  };

  if (!prefersReducedMotion && 'IntersectionObserver' in window && revealTargets.length > 0) {
    document.documentElement.classList.add('has-reveal');

    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting && entry.boundingClientRect.top >= window.innerHeight * 0.98) {
            return;
          }
          triggerRevealElement(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.04, rootMargin: '0px 0px -15px 0px' }
    );

    revealTargets.forEach((el) => revealObserver.observe(el));
  } else {
    revealTargets.forEach(triggerRevealElement);
  }
})();
