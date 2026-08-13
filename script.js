(function () {
  const LOG_PREFIX = '[Jikji-SF-Plugin]';
  console.log(LOG_PREFIX, '0/3 Category-Level Fullpage UI loaded.');

  const PLUGIN_ID = 'jikji_sf';
  const FETCH_LIMIT = 200; // 실제 목록은 60여 권이라 넉넉히 요청

  // 커버 이미지가 없는 목록이라, 제목 문자열을 해시해 고정된 그라디언트
  // 색상을 부여합니다 (같은 책은 항상 같은 색이 나오도록).
  const GRADIENTS = [
    ['#7c3aed', '#4c1d95'],
    ['#0ea5e9', '#1e3a8a'],
    ['#f97316', '#7c2d12'],
    ['#ef4444', '#7f1d1d'],
    ['#10b981', '#064e3b'],
    ['#eab308', '#78350f'],
    ['#ec4899', '#831843'],
    ['#6366f1', '#312e81'],
  ];

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i += 1) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function gradientFor(title) {
    const idx = hashString(title || '') % GRADIENTS.length;
    return GRADIENTS[idx];
  }

  function extractCatalogCode(publisher) {
    const m = /No\.([A-Za-z0-9]+)/.exec(publisher || '');
    return m ? m[1] : '';
  }

  // 정렬용 숫자 키: "e01" 같은 특별판 코드는 숫자 목록 뒤로 보냅니다.
  function catalogSortKey(code) {
    if (!code) return Number.MAX_SAFE_INTEGER;
    const digits = code.replace(/\D/g, '');
    const n = digits ? parseInt(digits, 10) : Number.MAX_SAFE_INTEGER;
    return /^[A-Za-z]/.test(code) ? n + 1000 : n;
  }

  let allItems = [];
  let sortMode = 'title'; // 'title' | 'number'

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderGrid(items) {
    const grid = document.getElementById('jf-grid');
    const status = document.getElementById('jf-status');
    if (!grid || !status) return;

    grid.innerHTML = '';

    if (items.length === 0) {
      status.textContent = '검색 결과가 없습니다.';
      status.style.display = 'block';
      return;
    }
    status.style.display = 'none';

    items.forEach((item) => {
      const card = el('a', 'jf-card');
      card.href = item.link || '#';
      card.target = '_blank';
      card.rel = 'noopener noreferrer';

      const [c1, c2] = gradientFor(item.title || '');
      const cover = el('div', 'jf-cover');
      cover.style.background = `linear-gradient(160deg, ${c1}, ${c2})`;

      // 카드 표지 영역이 커서(220px) 큰 버전을 우선 시도하고, 실패하면
      // 작은 썸네일 -> 그라디언트+글자 placeholder 순서로 대체합니다.
      const glyph = el('div', 'jf-cover-glyph', (item.title || '?').trim().slice(0, 1));
      const rocketIcon = el('i', 'jf-cover-icon fa-solid fa-rocket');
      const primarySrc = item.cover_large || item.cover;
      const fallbackSrc = item.cover_large ? item.cover : '';

      if (primarySrc) {
        const img = el('img', 'jf-cover-img');
        img.src = primarySrc;
        img.alt = item.title || '';
        img.loading = 'lazy';
        let triedFallback = false;
        img.addEventListener('error', () => {
          if (!triedFallback && fallbackSrc) {
            triedFallback = true;
            img.src = fallbackSrc;
            return;
          }
          img.remove();
          cover.appendChild(glyph);
          cover.appendChild(rocketIcon);
        });
        cover.appendChild(img);
      } else {
        cover.appendChild(glyph);
        cover.appendChild(rocketIcon);
      }

      const catalogCode = item.catalog_code || extractCatalogCode(item.publisher);
      if (catalogCode) {
        const badge = el('span', 'jf-badge-count', `No.${catalogCode}`);
        cover.appendChild(badge);
      }

      const formatWrap = el('div', 'jf-format-badges');
      formatWrap.appendChild(el('span', 'jf-format-chip', 'PDF'));
      if ((item.publisher || '').includes('HWP')) {
        formatWrap.appendChild(el('span', 'jf-format-chip', 'HWP'));
      }
      cover.appendChild(formatWrap);

      card.appendChild(cover);

      const info = el('div', 'jf-info');
      info.appendChild(el('p', 'jf-info-title', item.title || '제목 없음'));
      info.appendChild(el('p', 'jf-info-author', item.author || '저자 미상'));
      card.appendChild(info);

      grid.appendChild(card);
    });
  }

  function applyFilterAndSort() {
    const searchInput = document.getElementById('jf-search-input');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

    let items = allItems;
    if (query) {
      items = items.filter((item) => {
        const title = (item.title || '').toLowerCase();
        const author = (item.author || '').toLowerCase();
        return title.includes(query) || author.includes(query);
      });
    }

    items = items.slice();
    if (sortMode === 'number') {
      items.sort((a, b) => {
        const codeA = a.catalog_code || extractCatalogCode(a.publisher);
        const codeB = b.catalog_code || extractCatalogCode(b.publisher);
        return catalogSortKey(codeA) - catalogSortKey(codeB);
      });
    } else {
      items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
    }

    renderGrid(items);

    const countEl = document.getElementById('jf-count');
    if (countEl) {
      countEl.textContent = query
        ? `(검색결과 ${items.length}권 / 전체 ${allItems.length}권)`
        : `(전체 ${allItems.length}권)`;
    }
  }

  function fetchList() {
    const status = document.getElementById('jf-status');
    const grid = document.getElementById('jf-grid');
    const countEl = document.getElementById('jf-count');
    if (!status || !grid) {
      console.warn(LOG_PREFIX, '컨테이너 엘리먼트(#jf-status/#jf-grid)를 찾지 못함');
      return;
    }

    status.textContent = '불러오는 중...';
    status.style.display = 'block';
    grid.innerHTML = '';
    if (countEl) countEl.textContent = '(불러오는 중…)';

    const params = new URLSearchParams({ type: 'general', limit: String(FETCH_LIMIT) });
    const url = `/api/media/dashboard/widgets/${PLUGIN_ID}/data?${params.toString()}`;

    console.log(LOG_PREFIX, '1/3 데이터 요청 시작:', url);
    const t0 = performance.now();

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
        if (!data.success) {
          console.warn(LOG_PREFIX, '2/3 서버 오류 응답 (' + elapsed + 's):', data.error);
          status.textContent = '목록을 가져오지 못했습니다: ' + (data.error || '알 수 없는 오류');
          status.style.display = 'block';
          if (countEl) countEl.textContent = '';
          return;
        }
        allItems = Array.isArray(data.items) ? data.items : [];
        console.log(LOG_PREFIX, `2/3 데이터 파싱 완료 (${elapsed}s): 항목 ${allItems.length}개`);
        applyFilterAndSort();
      })
      .catch((err) => {
        console.error(LOG_PREFIX, '1/3 요청 실패:', err);
        status.textContent = '서버 연결 오류';
        status.style.display = 'block';
        if (countEl) countEl.textContent = '';
      });
  }

  const searchInput = document.getElementById('jf-search-input');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilterAndSort, 200);
    });
  }

  const searchBtn = document.getElementById('jf-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', applyFilterAndSort);
  }

  const sortBtn = document.getElementById('jf-sort-btn');
  const sortLabel = document.getElementById('jf-sort-label');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      sortMode = sortMode === 'title' ? 'number' : 'title';
      if (sortLabel) sortLabel.textContent = sortMode === 'title' ? '가나다순' : '번호순';
      applyFilterAndSort();
    });
  }

  const refreshBtn = document.getElementById('jf-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchList);
  }

  fetchList();
})();
