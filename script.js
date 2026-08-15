// jikji_sf 플러그인 풀페이지 스크립트
// new Function('pluginId', 'container', ...)로 실행되므로 import 없이 window 전역 API +
// 인자로 받는 container만 사용합니다 (gutenberg_browser 샘플과 동일한 방식).

(function () {
  const LOG_PREFIX = '[Jikji-SF-Plugin]';
  console.log(LOG_PREFIX, '0/3 Category-Level Fullpage UI loaded.');

  const FETCH_LIMIT = 200; // 실제 목록은 60여 권이라 넉넉히 요청
  const DB_TYPE = 'general';

  // 커버 이미지가 없는 항목을 대비해, 제목 문자열을 해시해 고정된 그라디언트
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

  function setImportStatus(text, isError) {
    const statusEl = container.querySelector('#jf-import-status');
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.style.color = isError ? '#ef4444' : '';
  }

  function getSelectedLibraryId() {
    const select = container.querySelector('#jf-library-select');
    return select ? select.value : '';
  }

  async function loadLibraries() {
    const select = container.querySelector('#jf-library-select');
    if (!select) return;
    try {
      const res = await fetch(`/api/media/libraries?type=${DB_TYPE}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.libraries)) {
        data.libraries.forEach((lib) => {
          const opt = document.createElement('option');
          opt.value = lib.id;
          opt.textContent = lib.name;
          select.appendChild(opt);
        });
      }
    } catch (e) {
      console.error(LOG_PREFIX, '라이브러리 목록 로드 실패:', e);
    }
  }

  async function handlePreviewClick(item) {
    if (!item.link) return;
    if (!window.BookOasisPlugin || typeof window.BookOasisPlugin.openWebview !== 'function') {
      window.open(item.link, '_blank', 'noopener,noreferrer');
      return;
    }
    // openWebview 내부에서 화이트리스트 미등록/응답 15MB 초과 등은 토스트로 안내됨.
    window.BookOasisPlugin.openWebview(item.link);
  }

  async function handleDownloadClick(item, btn) {
    const libraryId = getSelectedLibraryId();
    if (!libraryId) {
      setImportStatus('먼저 상단에서 가져올 라이브러리를 선택해주세요.', true);
      return;
    }
    if (!item.link) {
      setImportStatus('이 항목은 다운로드 링크가 없습니다.', true);
      return;
    }
    if (!window.BookOasisPlugin || typeof window.BookOasisPlugin.downloadToLibrary !== 'function') {
      setImportStatus('다운로드 API를 사용할 수 없습니다.', true);
      return;
    }

    const originalIcon = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    setImportStatus(`"${item.title}" 다운로드 중...`);

    try {
      const result = await window.BookOasisPlugin.downloadToLibrary(item.link, {
        libraryId,
        dbType: DB_TYPE,
      });
      if (result && result.success) {
        setImportStatus(
          `완료: ${result.filename}${result.imported_as_book ? ' (도서로 등록됨)' : ' (지원되지 않는 형식이라 도서로 등록되지 않음)'}`
        );
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => {
          btn.innerHTML = originalIcon;
        }, 2000);
      } else {
        setImportStatus((result && (result.message || result.error)) || '다운로드에 실패했습니다.', true);
        btn.innerHTML = originalIcon;
      }
    } catch (e) {
      setImportStatus('다운로드 요청 중 오류가 발생했습니다.', true);
      btn.innerHTML = originalIcon;
    } finally {
      btn.disabled = false;
    }
  }

  function renderGrid(items) {
    const grid = container.querySelector('#jf-grid');
    const status = container.querySelector('#jf-status');
    if (!grid || !status) return;

    grid.innerHTML = '';

    if (items.length === 0) {
      status.textContent = '검색 결과가 없습니다.';
      status.style.display = 'block';
      return;
    }
    status.style.display = 'none';

    items.forEach((item) => {
      // 카드 자체는 클릭 시 "앱 내 미리보기"(openWebview 모달)를 엽니다.
      // 우클릭 > 새 탭에서 열기 등 브라우저 기본 동작을 위해 href는 유지합니다.
      const card = el('a', 'jf-card');
      card.href = item.link || '#';
      card.rel = 'noopener noreferrer';
      card.addEventListener('click', (event) => {
        event.preventDefault();
        handlePreviewClick(item);
      });

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
      cover.appendChild(formatWrap);

      // 라이브러리로 가져오기 버튼 (카드 이동/새탭 열림과 분리)
      const downloadBtn = el('button', 'jf-download-btn');
      downloadBtn.type = 'button';
      downloadBtn.title = '선택한 라이브러리로 가져오기';
      downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
      downloadBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleDownloadClick(item, downloadBtn);
      });
      cover.appendChild(downloadBtn);

      // 새 탭에서 원본 그대로 열기 (프록시/화이트리스트 없이 브라우저가 직접 접속,
      // 15MB 제한이 있는 앱 내 미리보기보다 큰 파일에 유리)
      const newTabBtn = el('button', 'jf-newtab-btn');
      newTabBtn.type = 'button';
      newTabBtn.title = '새 탭에서 원본 열기';
      newTabBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i>';
      newTabBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.link) window.open(item.link, '_blank', 'noopener,noreferrer');
      });
      cover.appendChild(newTabBtn);

      card.appendChild(cover);

      const info = el('div', 'jf-info');
      info.appendChild(el('p', 'jf-info-title', item.title || '제목 없음'));
      info.appendChild(el('p', 'jf-info-author', item.author || '저자 미상'));
      card.appendChild(info);

      grid.appendChild(card);
    });
  }

  function applyFilterAndSort() {
    const searchInput = container.querySelector('#jf-search-input');
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

    const countEl = container.querySelector('#jf-count');
    if (countEl) {
      countEl.textContent = query
        ? `(검색결과 ${items.length}권 / 전체 ${allItems.length}권)`
        : `(전체 ${allItems.length}권)`;
    }
  }

  function fetchList() {
    const status = container.querySelector('#jf-status');
    const grid = container.querySelector('#jf-grid');
    const countEl = container.querySelector('#jf-count');
    if (!status || !grid) {
      console.warn(LOG_PREFIX, '컨테이너 엘리먼트(#jf-status/#jf-grid)를 찾지 못함');
      return;
    }

    status.textContent = '불러오는 중...';
    status.style.display = 'block';
    grid.innerHTML = '';
    if (countEl) countEl.textContent = '(불러오는 중…)';

    const params = new URLSearchParams({ type: DB_TYPE, limit: String(FETCH_LIMIT) });
    const url = `/api/media/dashboard/widgets/${pluginId}/data?${params.toString()}`;

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

  const searchInput = container.querySelector('#jf-search-input');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyFilterAndSort, 200);
    });
  }

  const searchBtn = container.querySelector('#jf-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', applyFilterAndSort);
  }

  const sortBtn = container.querySelector('#jf-sort-btn');
  const sortLabel = container.querySelector('#jf-sort-label');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      sortMode = sortMode === 'title' ? 'number' : 'title';
      if (sortLabel) sortLabel.textContent = sortMode === 'title' ? '가나다순' : '번호순';
      applyFilterAndSort();
    });
  }

  const refreshBtn = container.querySelector('#jf-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchList);
  }

  loadLibraries();
  fetchList();
})();
