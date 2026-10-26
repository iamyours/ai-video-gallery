(function () {
  'use strict';

  var DOTS = ['#e7b089', '#9dccb4', '#e0b15a', '#9eb7d4', '#e7a0a6'];
  var PRIVATE_HOSTS = { 'gemini.google.com': true, 'www.gemini.google.com': true };

  var data = null;
  var videos = [];
  var bySlug = new Map();
  var filter = 'all';
  var booted = false;
  var currentSlug = null;
  var activeList = null;
  var copyTimers = new WeakMap();
  var suppressCloseNav = false;
  var feedItems = [];
  var feedSlides = [];
  var feedIndex = -1;
  var feedListKey = '';
  var feedMuted = true;
  var feedWheelLock = false;
  var sheetOpen = false;

  var statusEl = document.getElementById('status');
  var catalogEl = document.getElementById('catalog');
  var filtersEl = document.getElementById('filters');
  var countEl = document.getElementById('count');
  var dialog = document.getElementById('player');
  var video = document.getElementById('player-video');
  var playlistBar = document.getElementById('playlist-bar');
  var errorEl = document.getElementById('player-error');
  var live = document.getElementById('live');
  var feedRoot = document.getElementById('feed');
  var feedScroller = document.getElementById('feed-scroller');
  var feedSheet = document.getElementById('feed-sheet');
  var feedSheetBody = document.getElementById('feed-sheet-body');

  document.getElementById('player-close').addEventListener('click', function () {
    go(filterHash());
  });

  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', function () {
    stopMedia();
    document.body.classList.remove('player-open');
    currentSlug = null;
    activeList = null;
    highlightCard(null);
    document.title = 'AI 视频画廊';
    if (!suppressCloseNav && parseRoute().type === 'video' && !feedParam()) {
      history.replaceState(null, '', location.pathname + location.search + filterHash());
    }
  });

  dialog.addEventListener('keydown', function (event) {
    if (!activeList || event.target === video) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    var index = activeList.items.findIndex(function (item) { return item.slug === currentSlug; });
    if (event.key === 'ArrowRight' && index >= 0 && index < activeList.items.length - 1) {
      event.preventDefault();
      go(videoHash(activeList.items[index + 1].slug, activeList.category));
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      go(videoHash(activeList.items[index - 1].slug, activeList.category));
    }
  });

  video.addEventListener('ended', function () {
    if (!activeList || !currentSlug) return;
    var index = activeList.items.findIndex(function (item) { return item.slug === currentSlug; });
    if (index < 0 || index >= activeList.items.length - 1) {
      var label = playlistBar.querySelector('p');
      if (label) label.textContent = '已播完 ' + activeList.items.length + ' 段';
      return;
    }
    go(videoHash(activeList.items[index + 1].slug, activeList.category));
  });

  video.addEventListener('error', function () {
    if (!dialog.open || !video.getAttribute('src')) return;
    errorEl.hidden = false;
    errorEl.textContent = '视频没有加载成功。';
  });

  window.addEventListener('hashchange', applyRoute);
  window.addEventListener('popstate', applyRoute);
  document.getElementById('feed-entry').addEventListener('click', function () {
    var list = currentFeedList();
    if (!list.length) return;
    openFeed(list[0].slug);
  });
  document.getElementById('feed-back').addEventListener('click', closeFeed);
  document.getElementById('feed-sheet-close').addEventListener('click', closeSheet);
  document.getElementById('feed-sheet-backdrop').addEventListener('click', closeSheet);
  feedScroller.addEventListener('scroll', function () {
    window.requestAnimationFrame(syncFeedFromScroll);
  }, { passive: true });
  feedScroller.addEventListener('wheel', function (event) {
    if (feedRoot.hidden || sheetOpen) return;
    event.preventDefault();
    if (feedWheelLock) return;
    if (Math.abs(event.deltaY) < 4 && Math.abs(event.deltaX) < 4) return;
    var dir = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? (event.deltaY > 0 ? 1 : -1)
      : (event.deltaX > 0 ? 1 : -1);
    feedWheelLock = true;
    moveFeed(dir);
    setTimeout(function () { feedWheelLock = false; }, 560);
  }, { passive: false });
  window.addEventListener('keydown', function (event) {
    if (feedRoot.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sheetOpen) closeSheet();
      else closeFeed();
      return;
    }
    if (sheetOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveFeed(1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFeed(-1);
    }
  });
  var filterBar = document.querySelector('.filter-bar');
  window.addEventListener('scroll', function () {
    if (filterBar) filterBar.classList.toggle('is-stuck', window.scrollY > 8);
  }, { passive: true });

  fetch('data/manifest.json', { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('manifest ' + response.status);
      return response.json();
    })
    .then(function (payload) {
      data = payload;
      videos = Array.isArray(payload.videos) ? payload.videos : [];
      videos.forEach(function (item) { bySlug.set(item.slug, item); });
      if (countEl) countEl.textContent = '共 ' + videos.length + ' 条';
      applyRoute();
    })
    .catch(function () {
      statusEl.hidden = false;
      statusEl.textContent = '画廊数据没有加载成功。';
    });

  function applyRoute() {
    var route = parseRoute();
    var querySlug = feedParam();
    if (route.type === 'all') filter = 'all';
    else if (route.type === 'cat' && categoryKnown(route.category)) filter = route.category;
    else if (route.type === 'video' && !booted) {
      if (route.list && categoryKnown(route.list)) filter = route.list;
      else if (bySlug.has(route.slug)) filter = bySlug.get(route.slug).category;
    }
    if (querySlug && bySlug.has(querySlug) && !currentFeedList().some(function (item) { return item.slug === querySlug; })) {
      filter = bySlug.get(querySlug).category;
    }
    booted = true;
    render();
    if (querySlug && bySlug.has(querySlug)) {
      closePlayerQuiet();
      showFeed(querySlug);
      return;
    }
    hideFeed();
    if (route.type === 'video' && bySlug.has(route.slug)) {
      var seq = route.list ? sequenceFor(route.list) : null;
      var inSeq = seq && seq.items.some(function (item) { return item.slug === route.slug; });
      showVideo(route.slug, inSeq ? seq : null, { autoplay: true, focusPrompt: route.focusPrompt });
    } else {
      closePlayer();
    }
  }

  function parseRoute() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash || hash === 'all') return { type: 'all' };
    var params = new URLSearchParams(hash);
    if (params.get('v')) {
      return {
        type: 'video',
        slug: params.get('v'),
        list: params.get('list'),
        focusPrompt: params.get('panel') === 'prompt'
      };
    }
    if (params.get('cat')) return { type: 'cat', category: params.get('cat') };
    return { type: 'all' };
  }

  function categoryOrder() {
    var ids = [];
    var seen = Object.create(null);
    (data.categories || []).forEach(function (category) {
      if (!category || !category.id || seen[category.id]) return;
      seen[category.id] = true;
      ids.push(category.id);
    });
    videos.forEach(function (item) {
      if (!item.category || seen[item.category]) return;
      seen[item.category] = true;
      ids.push(item.category);
    });
    return ids;
  }

  function categoryKnown(id) {
    return categoryOrder().indexOf(id) !== -1;
  }

  function categoryMeta(id) {
    var found = (data.categories || []).find(function (category) { return category.id === id; });
    return found || { id: id, description: '', banner: null, banner_alt: '' };
  }

  function sequenceFor(categoryId) {
    var host = videos.find(function (item) {
      return item.category === categoryId && Array.isArray(item.segments) && item.segments.length;
    });
    if (!host) return null;
    var items = host.segments.map(function (slug) { return bySlug.get(slug); }).filter(Boolean);
    if (!items.length) return null;
    return { category: categoryId, host: host, items: items };
  }

  function sequenceLabel(seq) {
    if (seq.host && seq.host.episode != null) return '按顺序播放第 ' + seq.host.episode + ' 集片段';
    return '按顺序播放';
  }

  function render() {
    renderFilters();
    catalogEl.replaceChildren();
    statusEl.hidden = true;
    var ids = filter === 'all' ? categoryOrder() : [filter];
    var any = false;
    ids.forEach(function (id) {
      var items = videos.filter(function (item) { return item.category === id; });
      if (!items.length) return;
      any = true;
      catalogEl.appendChild(renderCategory(id, items));
    });
    if (!any) {
      statusEl.hidden = false;
      statusEl.textContent = '这个分类里还没有视频。';
    }
    highlightCard(currentSlug);
  }

  function renderFilters() {
    filtersEl.replaceChildren();
    var ids = categoryOrder();
    filtersEl.appendChild(filterButton('全部', 'all', videos.length));
    ids.forEach(function (id) {
      var count = videos.filter(function (item) { return item.category === id; }).length;
      filtersEl.appendChild(filterButton(id, id, count));
    });
  }

  function filterButton(label, id, count) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-btn';
    button.setAttribute('aria-pressed', filter === id ? 'true' : 'false');
    button.textContent = label + ' ' + count;
    button.addEventListener('click', function () {
      go(id === 'all' ? '#all' : '#cat=' + encodeURIComponent(id));
    });
    return button;
  }

  function renderCategory(id, items) {
    var meta = categoryMeta(id);
    var seq = sequenceFor(id);
    var section = document.createElement('section');
    section.className = 'category-block';
    if (filter !== 'all' && meta.banner) section.appendChild(renderBanner(meta, seq));
    else section.appendChild(renderSectionHead(meta, seq));
    var grid = document.createElement('div');
    grid.className = 'grid';
    items.forEach(function (item) { grid.appendChild(renderCard(item)); });
    section.appendChild(grid);
    return section;
  }

  function renderSectionHead(meta, seq) {
    var head = document.createElement('div');
    head.className = 'section-head';
    var text = document.createElement('div');
    var title = document.createElement('h2');
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = dotColor(meta.id);
    title.append(dot, document.createTextNode(meta.id));
    text.appendChild(title);
    if (meta.description) text.appendChild(el('p', 'section-copy', meta.description));
    head.appendChild(text);
    if (seq) head.appendChild(playAllButton(seq));
    return head;
  }

  function renderBanner(meta, seq) {
    var figure = document.createElement('figure');
    figure.className = 'banner';
    var image = document.createElement('img');
    image.src = meta.banner;
    image.alt = meta.banner_alt || meta.id;
    var copy = document.createElement('figcaption');
    copy.className = 'banner-copy';
    copy.appendChild(el('p', 'kicker', '角色设定'));
    copy.appendChild(el('h2', null, meta.id));
    if (meta.description) copy.appendChild(el('p', null, meta.description));
    if (seq) copy.appendChild(playAllButton(seq));
    figure.append(image, copy);
    return figure;
  }

  function playAllButton(seq) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.textContent = sequenceLabel(seq);
    button.addEventListener('click', function () {
      go(videoHash(seq.items[0].slug, seq.category));
    });
    return button;
  }

  function renderCard(item) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.slug = item.slug;
    card.dataset.aspect = item.aspect || '';
    var href = feedHref(item.slug);
    var link = document.createElement('a');
    link.className = 'card-link';
    link.href = href;
    link.addEventListener('click', function (event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openFeed(item.slug);
    });

    var media = document.createElement('div');
    media.className = 'card-media';
    var image = document.createElement('img');
    image.src = item.cover;
    image.alt = '';
    var aspect = document.createElement('span');
    aspect.className = 'badge badge-aspect ' + aspectClass(item.aspect);
    aspect.textContent = item.aspect || '';
    var time = document.createElement('span');
    time.className = 'badge badge-time';
    time.textContent = formatDuration(item.duration_s);
    var play = document.createElement('span');
    play.className = 'play-disc';
    play.appendChild(playIcon());
    media.append(image, aspect, time, play);

    var copy = document.createElement('div');
    copy.className = 'card-copy';
    var series = seriesLabel(item);
    if (series) copy.appendChild(el('p', 'series-label', series));
    copy.appendChild(el('h3', 'card-title', item.title_zh || item.slug));
    copy.appendChild(el('p', 'card-meta', [item.category, item.model].filter(Boolean).join(' · ')));
    link.append(media, copy);
    card.appendChild(link);
    return card;
  }

  function showVideo(slug, list, options) {
    var item = bySlug.get(slug);
    if (!item) return;
    var sameMedia = dialog.open && currentSlug === slug && video.getAttribute('src');
    currentSlug = slug;
    activeList = list;
    populate(item);
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('player-open');
    document.title = item.title_zh + ' · AI 视频画廊';
    highlightCard(slug);
    if (!sameMedia) {
      errorEl.hidden = true;
      video.setAttribute('aria-label', item.title_zh || item.slug);
      video.poster = mediaUrl(item.cover);
      video.classList.toggle('is-portrait', item.aspect === '9:16' || item.aspect === '2:3');
      video.classList.toggle('is-landscape', item.aspect !== '9:16' && item.aspect !== '2:3');
      video.src = mediaUrl(item.video);
      if (options.autoplay) {
        var pending = video.play();
        if (pending && typeof pending.catch === 'function') pending.catch(function () {});
      }
    }
    if (options.focusPrompt) {
      var prompt = document.getElementById('player-prompt');
      if (prompt) prompt.scrollIntoView({ block: 'nearest' });
    }
  }

  function populate(item) {
    document.getElementById('player-kicker').textContent = seriesLabel(item) || item.category || '';
    document.getElementById('player-title').textContent = item.title_zh || item.slug;
    var subtitle = document.getElementById('player-subtitle');
    subtitle.textContent = item.title_en || '';
    subtitle.hidden = !item.title_en;
    renderMeta(item);
    renderActions(item);
    renderPrompt(item);
    renderPlaylist(item);
  }

  function renderMeta(item) {
    var meta = document.getElementById('player-meta');
    meta.replaceChildren();
    addMeta(meta, '分类', item.category);
    addMeta(meta, '时长', formatDuration(item.duration_s));
    addMeta(meta, '画幅', item.aspect);
    addMeta(meta, '模型', item.model);
    addMeta(meta, '日期', formatDate(item.created));
    if (item.width && item.height) addMeta(meta, '尺寸', item.width + '×' + item.height);
  }

  function addMeta(meta, label, value) {
    if (value == null || value === '') return;
    meta.append(el('dt', null, label), el('dd', null, String(value)));
  }

  function renderActions(item) {
    var actions = document.getElementById('player-actions');
    actions.replaceChildren();
    var raw = rawUrl(item);
    var pageUrl = mediaUrl(item.video);

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn';
    copyBtn.textContent = '复制视频链接';
    copyBtn.dataset.rawUrl = raw;
    copyBtn.title = raw;
    copyBtn.addEventListener('click', function () {
      copyText(raw, copyBtn, '已复制视频链接');
    });

    var open = document.createElement('a');
    open.className = 'btn';
    open.href = pageUrl;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '打开视频';

    actions.append(copyBtn, open);
    var seq = sequenceFor(item.category);
    var already = activeList && seq && activeList.category === seq.category && activeList.host === seq.host;
    if (seq && !already) actions.appendChild(playAllButton(seq));
    actions.append(fileLine('播放地址', pageUrl), fileLine('文件直链', raw));
  }

  function fileLine(label, url) {
    var line = document.createElement('p');
    line.className = 'file-url';
    line.append(document.createTextNode(label + ' '), el('code', null, url));
    return line;
  }

  function renderPrompt(item) {
    var section = document.getElementById('player-prompt');
    section.replaceChildren();
    var head = document.createElement('div');
    head.className = 'prompt-head';
    head.appendChild(el('h3', null, '提示词'));
    var hasPrompt = typeof item.prompt === 'string' && item.prompt.length > 0;
    if (hasPrompt) {
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-small';
      copyBtn.textContent = '复制提示词';
      copyBtn.addEventListener('click', function () {
        copyText(item.prompt, copyBtn, '已复制提示词');
      });
      head.appendChild(copyBtn);
    }
    section.appendChild(head);
    if (hasPrompt) {
      var pre = document.createElement('pre');
      pre.className = 'prompt-text';
      pre.textContent = item.prompt;
      section.appendChild(pre);
    } else {
      section.appendChild(el('p', 'prompt-missing', '提示词未记录'));
    }

    appendNote(section, item);
    var sourceText = promptSourceText(item.prompt_source);
    if (sourceText) section.appendChild(el('p', 'prompt-source', '出处：' + sourceText));

    if (Array.isArray(item.segments) && item.segments.length) {
      var wrap = document.createElement('div');
      wrap.className = 'segment-links';
      wrap.appendChild(el('p', null, '分段提示词'));
      var list = document.createElement('ol');
      item.segments.forEach(function (slug) {
        var seg = bySlug.get(slug);
        var li = document.createElement('li');
        var hash = videoHash(slug) + '&panel=prompt';
        var anchor = document.createElement('a');
        anchor.href = hash;
        anchor.textContent = seg ? seg.title_zh : slug;
        anchor.addEventListener('click', function (event) {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          go(hash);
        });
        li.appendChild(anchor);
        list.appendChild(li);
      });
      wrap.appendChild(list);
      section.appendChild(wrap);
    }

    var inspiration = publicInspirationUrl(item.source_url);
    if (inspiration) {
      var link = document.createElement('a');
      link.className = 'inspiration';
      link.href = inspiration;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '灵感来源';
      section.appendChild(link);
    }
  }

  function renderPlaylist(item) {
    if (!activeList) {
      playlistBar.hidden = true;
      playlistBar.replaceChildren();
      return;
    }
    var index = activeList.items.findIndex(function (entry) { return entry.slug === item.slug; });
    playlistBar.hidden = false;
    playlistBar.replaceChildren();
    playlistBar.appendChild(el('p', null, '连续播放 ' + (index + 1) + '/' + activeList.items.length + ' · ' + (item.title_zh || item.slug)));
    var controls = document.createElement('div');
    controls.className = 'playlist-controls';
    controls.append(
      stepButton('上一段', index <= 0, function () { go(videoHash(activeList.items[index - 1].slug, activeList.category)); }),
      stepButton('下一段', index < 0 || index >= activeList.items.length - 1, function () { go(videoHash(activeList.items[index + 1].slug, activeList.category)); })
    );
    playlistBar.appendChild(controls);
  }

  function stepButton(label, disabled, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function closePlayerQuiet() {
    if (!dialog.open) return;
    suppressCloseNav = true;
    dialog.close();
    suppressCloseNav = false;
  }

  function closePlayer() {
    if (dialog.open) dialog.close();
    else {
      stopMedia();
      document.body.classList.remove('player-open');
      currentSlug = null;
      activeList = null;
      highlightCard(null);
      document.title = 'AI 视频画廊';
    }
  }

  function stopMedia() {
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
  }

  function highlightCard(slug) {
    document.querySelectorAll('.card').forEach(function (card) {
      card.classList.toggle('is-current', card.dataset.slug === slug);
    });
  }

  function go(hash) {
    if (!hash) hash = '#all';
    if (location.hash === hash) applyRoute();
    else location.hash = hash;
  }

  function filterHash() {
    return filter === 'all' ? '#all' : '#cat=' + encodeURIComponent(filter);
  }

  function videoHash(slug, listCategory) {
    var hash = '#v=' + encodeURIComponent(slug);
    if (listCategory) hash += '&list=' + encodeURIComponent(listCategory);
    return hash;
  }

  function mediaUrl(path) {
    return new URL(path, document.baseURI).href;
  }

  function rawUrl(item) {
    var base = data.raw_base || '';
    if (base && base.charAt(base.length - 1) !== '/') base += '/';
    return base + item.video;
  }

  // source_url is the only public inspiration link.
  // prompt_source is plain provenance. Private Gemini chat URLs are never linked or shown.
  function publicInspirationUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var url;
    try { url = new URL(value.trim()); } catch (error) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (PRIVATE_HOSTS[url.hostname.toLowerCase()]) return null;
    return url.href;
  }

  function promptSourceText(value) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/https?:\/\/(?:www\.)?gemini\.google\.com\/[^\s)]+/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim();
  }

  function seriesLabel(item) {
    if (item.episode == null) return '';
    if (Array.isArray(item.segments) && item.segments.length) return '第 ' + item.episode + ' 集 · 合集';
    if (typeof item.order === 'number' && item.order > 0) return '第 ' + item.episode + ' 集 · 片段 ' + item.order;
    return '第 ' + item.episode + ' 集';
  }

  function aspectClass(aspect) {
    if (aspect === '9:16' || aspect === '2:3') return 'is-portrait';
    if (aspect === '16:9') return 'is-landscape';
    return 'is-other';
  }

  function dotColor(categoryId) {
    var index = categoryOrder().indexOf(categoryId);
    if (index < 0) index = 0;
    return DOTS[index % DOTS.length];
  }

  function formatDuration(seconds) {
    var value = Number(seconds);
    if (!isFinite(value)) return '';
    var rounded = Math.round(value);
    var minutes = Math.floor(rounded / 60);
    var secs = rounded % 60;
    if (minutes <= 0) return secs + ' 秒';
    if (secs === 0) return minutes + ' 分钟';
    return minutes + ' 分 ' + String(secs).padStart(2, '0') + ' 秒';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Los_Angeles'
      }).format(date);
    } catch (error) {
      return String(iso).slice(0, 10);
    }
  }

  function copyText(text, button, announcement) {
    var original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    var done = function (ok) {
      button.textContent = ok ? '已复制' : '复制失败';
      button.classList.toggle('is-copied', ok);
      live.textContent = ok ? announcement : '复制失败';
      var previous = copyTimers.get(button);
      if (previous) clearTimeout(previous);
      copyTimers.set(button, setTimeout(function () {
        button.textContent = original;
        button.classList.remove('is-copied');
      }, 1600));
    };
    var fallback = function () {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      area.remove();
      done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function currentFeedList() {
    if (filter === 'all') return videos.slice();
    return videos.filter(function (item) { return item.category === filter; });
  }

  function feedParam() {
    return new URLSearchParams(location.search).get('v');
  }

  function feedHref(slug) {
    var url = new URL(location.href);
    url.searchParams.set('v', slug);
    return url.pathname + url.search + url.hash;
  }

  function openFeed(slug) {
    if (!bySlug.has(slug)) return;
    var url = new URL(location.href);
    url.searchParams.set('v', slug);
    var next = url.pathname + url.search + url.hash;
    var current = location.pathname + location.search + location.hash;
    if (next !== current) history.pushState({ feed: true }, '', next);
    applyRoute();
  }

  function closeFeed() {
    closeSheet();
    if (history.state && history.state.feed) {
      history.back();
      return;
    }
    var url = new URL(location.href);
    url.searchParams.delete('v');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
    applyRoute();
  }

  function showFeed(slug) {
    var list = currentFeedList();
    if (!list.some(function (item) { return item.slug === slug; })) return;
    var key = list.map(function (item) { return item.slug; }).join('|');
    var index = list.findIndex(function (item) { return item.slug === slug; });
    feedRoot.hidden = false;
    document.body.classList.add('feed-open');
    if (feedListKey !== key) {
      feedListKey = key;
      buildFeed(list);
    }
    void feedScroller.offsetHeight;
    scrollFeedTo(index, false);
  }

  function hideFeed() {
    if (feedRoot.hidden) return;
    closeSheet();
    feedSlides.forEach(function (slide) {
      var node = slide.querySelector('video');
      node.pause();
      node.removeAttribute('src');
      node.load();
    });
    feedRoot.hidden = true;
    document.body.classList.remove('feed-open');
    feedListKey = '';
    feedIndex = -1;
    feedItems = [];
    feedSlides = [];
    feedScroller.replaceChildren();
    if (!dialog.open) document.title = 'AI 视频画廊';
  }

  function buildFeed(list) {
    feedItems = list;
    feedSlides = [];
    feedIndex = -1;
    feedScroller.replaceChildren();
    list.forEach(function (item, index) {
      feedScroller.appendChild(buildSlide(item, index));
    });
  }

  function buildSlide(item, index) {
    var slide = document.createElement('article');
    slide.className = 'feed-slide ' + (item.aspect === '16:9' ? 'is-landscape' : 'is-portrait');
    if (item.aspect === '2:3') slide.classList.add('is-2x3');
    slide.dataset.index = String(index);
    var frame = document.createElement('div');
    frame.className = 'feed-frame';
    var node = document.createElement('video');
    node.poster = mediaUrl(item.cover);
    node.preload = 'none';
    node.loop = true;
    node.muted = true;
    node.playsInline = true;
    node.setAttribute('playsinline', '');
    node.setAttribute('aria-label', item.title_zh || item.slug);
    var hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'feed-hit';
    hit.setAttribute('aria-label', '播放或暂停');
    hit.addEventListener('click', function () {
      if (node.paused) playFeedVideo(node);
      else node.pause();
      slide.classList.toggle('is-paused', node.paused);
    });
    var pause = document.createElement('span');
    pause.className = 'feed-pause';
    pause.appendChild(playIcon());
    frame.append(node, hit, document.createElement('div'), pause);
    frame.children[2].className = 'feed-shade';
    frame.append(buildFeedMeta(item), buildFeedActions(item, node));
    slide.appendChild(frame);
    feedSlides[index] = slide;
    return slide;
  }

  function buildFeedMeta(item) {
    var meta = document.createElement('div');
    meta.className = 'feed-meta';
    meta.appendChild(el('h2', 'feed-title', item.title_zh || item.slug));
    var chips = document.createElement('div');
    chips.className = 'feed-chips';
    feedChipLabels(item).forEach(function (label) {
      chips.appendChild(el('span', 'feed-chip', label));
    });
    meta.appendChild(chips);
    return meta;
  }

  function feedChipLabels(item) {
    var labels = [];
    function add(label) {
      if (!label || labels.indexOf(label) !== -1) return;
      labels.push(String(label));
    }
    add(item.category);
    add(item.model);
    add(item.aspect);
    add(formatDuration(item.duration_s));
    if (Array.isArray(item.tags)) item.tags.forEach(add);
    return labels;
  }

  function buildFeedActions(item, node) {
    var actions = document.createElement('div');
    actions.className = 'feed-actions';
    actions.append(
      feedAction('💬', '提示词', function () { openSheet(item); }),
      feedAction('🔗', '链接', function (caption) {
        copyText(rawUrl(item), caption, '已复制视频链接');
      }),
      feedAction('↗', '分享', function (caption) { shareItem(item, caption); }),
      feedAction(feedMuted ? '🔇' : '🔊', feedMuted ? '开声音' : '静音', function () { toggleFeedMute(node); })
    );
    return actions;
  }

  function feedAction(emoji, label, onClick) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'feed-action';
    var bubble = el('span', 'feed-bubble', emoji);
    var caption = el('span', 'feed-caption', label);
    button.append(bubble, caption);
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      onClick(caption, bubble, button);
    });
    return button;
  }

  function scrollFeedTo(index, smooth) {
    var slide = feedSlides[index];
    if (!slide) return;
    var top = index * feedScroller.clientHeight;
    if (!smooth && Math.abs(feedScroller.scrollTop - top) < 2) {
      activateFeed(index);
      return;
    }
    feedScroller.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) activateFeed(index);
  }

  function moveFeed(delta) {
    if (feedIndex < 0) return;
    var next = feedIndex + delta;
    if (next < 0 || next >= feedItems.length) return;
    scrollFeedTo(next, true);
  }

  function syncFeedFromScroll() {
    if (feedRoot.hidden || !feedItems.length) return;
    var height = feedScroller.clientHeight || 1;
    var index = Math.round(feedScroller.scrollTop / height);
    if (index < 0) index = 0;
    if (index >= feedItems.length) index = feedItems.length - 1;
    if (index !== feedIndex) activateFeed(index);
  }

  function activateFeed(index) {
    if (index < 0 || index >= feedItems.length) return;
    var changed = index !== feedIndex;
    feedIndex = index;
    feedSlides.forEach(function (slide, i) {
      var node = slide.querySelector('video');
      var distance = Math.abs(i - index);
      if (distance <= 1) {
        var src = mediaUrl(feedItems[i].video);
        if (node.getAttribute('src') !== src) {
          node.poster = mediaUrl(feedItems[i].cover);
          node.preload = distance === 0 ? 'auto' : 'metadata';
          node.src = src;
        }
      } else if (node.getAttribute('src')) {
        node.pause();
        node.removeAttribute('src');
        node.load();
      }
      if (i !== index) {
        node.pause();
        slide.classList.remove('is-paused');
      }
    });
    var current = feedSlides[index].querySelector('video');
    current.loop = true;
    current.muted = feedMuted;
    playFeedVideo(current);
    feedSlides[index].classList.remove('is-paused');
    var count = document.getElementById('feed-count');
    if (count) count.textContent = (index + 1) + ' / ' + feedItems.length;
    document.title = (feedItems[index].title_zh || '刷视频') + ' · AI 视频画廊';
    updateMuteButtons();
    if (changed) {
      rememberFeedSlug(feedItems[index].slug);
      live.textContent = (feedItems[index].title_zh || '') + '，' + (index + 1) + ' / ' + feedItems.length;
    }
  }

  function playFeedVideo(node) {
    node.muted = feedMuted;
    var pending = node.play();
    if (pending && typeof pending.catch === 'function') {
      pending.catch(function () {
        node.muted = true;
        feedMuted = true;
        updateMuteButtons();
        var again = node.play();
        if (again && typeof again.catch === 'function') again.catch(function () {});
      });
    }
  }

  function toggleFeedMute(node) {
    feedMuted = !feedMuted;
    if (node) {
      node.muted = feedMuted;
      if (!feedMuted && node.paused) playFeedVideo(node);
    }
    updateMuteButtons();
  }

  function updateMuteButtons() {
    feedSlides.forEach(function (slide) {
      var buttons = slide.querySelectorAll('.feed-action');
      var sound = buttons[buttons.length - 1];
      if (!sound) return;
      var bubble = sound.querySelector('.feed-bubble');
      var caption = sound.querySelector('.feed-caption');
      if (bubble) bubble.textContent = feedMuted ? '🔇' : '🔊';
      if (caption && caption.dataset.label == null) caption.textContent = feedMuted ? '开声音' : '静音';
      sound.setAttribute('aria-pressed', feedMuted ? 'false' : 'true');
      sound.setAttribute('aria-label', feedMuted ? '开启声音' : '静音');
    });
  }

  function rememberFeedSlug(slug) {
    var url = new URL(location.href);
    if (url.searchParams.get('v') === slug) return;
    url.searchParams.set('v', slug);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }

  function openSheet(item) {
    feedSheetBody.replaceChildren();
    appendPromptBlock(feedSheetBody, '提示词', item.prompt);
    appendNote(feedSheetBody, item);
    var sourceText = promptSourceText(item.prompt_source);
    if (sourceText) feedSheetBody.appendChild(el('p', 'prompt-source', '出处：' + sourceText));
    if (Array.isArray(item.segments) && item.segments.length) {
      item.segments.forEach(function (slug, index) {
        var seg = bySlug.get(slug);
        if (!seg) return;
        appendPromptBlock(feedSheetBody, (index + 1) + '. ' + (seg.title_zh || slug), seg.prompt);
      });
    }
    var inspiration = publicInspirationUrl(item.source_url);
    if (inspiration) {
      var link = document.createElement('a');
      link.className = 'inspiration';
      link.href = inspiration;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '灵感来源';
      feedSheetBody.appendChild(link);
    }
    feedSheet.hidden = false;
    sheetOpen = true;
  }

  function appendNote(parent, item) {
    if (typeof item.notes !== 'string' || !item.notes.trim()) return;
    parent.appendChild(el('p', 'prompt-note', item.notes));
  }

  function appendPromptBlock(parent, title, prompt) {
    var block = document.createElement('section');
    block.className = 'feed-prompt-block';
    var head = document.createElement('div');
    head.className = 'prompt-head';
    head.appendChild(el('h3', null, title));
    var hasPrompt = typeof prompt === 'string' && prompt.length > 0;
    if (hasPrompt) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small';
      button.textContent = '复制提示词';
      button.addEventListener('click', function () {
        copyText(prompt, button, '已复制提示词');
      });
      head.appendChild(button);
    }
    block.appendChild(head);
    if (hasPrompt) {
      var pre = document.createElement('pre');
      pre.className = 'prompt-text';
      pre.textContent = prompt;
      block.appendChild(pre);
    } else {
      block.appendChild(el('p', 'prompt-missing', '提示词未记录'));
    }
    parent.appendChild(block);
  }

  function closeSheet() {
    if (feedSheet.hidden) return;
    feedSheet.hidden = true;
    sheetOpen = false;
  }

  function shareItem(item, caption) {
    var url = new URL(location.href);
    url.searchParams.set('v', item.slug);
    var shareUrl = url.origin + url.pathname + url.search;
    if (navigator.share) {
      navigator.share({ title: item.title_zh || item.slug, url: shareUrl }).catch(function () {});
      return;
    }
    copyText(shareUrl, caption, '已复制分享链接');
  }

  function playIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 2.5v11l10-5.5-10-5.5z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
})();
