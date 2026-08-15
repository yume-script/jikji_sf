# -*- coding: utf-8 -*-
"""
직지 프로젝트 SF (sf.jikji.org) 목록을 대시보드 위젯/카테고리 풀페이지로 보여주는 플러그인.

- 원본 사이트: https://sf.jikji.org/book/listview.html (1999년 제작된
  구형 프레임셋 사이트, EUC-KR 인코딩, 고정된 정적 목록)
- 검색/메타데이터 적용 기능은 지원하지 않는 "대시보드/카테고리 전용" 플러그인입니다.
- 매 요청마다 원본 사이트를 긁지 않도록 메모리 캐시(기본 6시간)를 둡니다.
- 풀페이지 뷰(index.html/script.js)에서 코어 제공 웹뷰/다운로드 API
  (window.BookOasisPlugin.downloadToLibrary, plugin_README.md §10)를 사용해
  PDF를 사용자가 지정한 라이브러리로 바로 가져올 수 있습니다. 이 기능을 쓰려면
  사용자가 [설정 > 외부 도메인] 탭에서 sf.jikji.org를 먼저 화이트리스트에
  등록해야 합니다 (플러그인이 임의로 등록/우회할 수 없음).
"""

import re
import time

import requests
from bs4 import BeautifulSoup

from plugins.metadata.base import BaseMetadataProvider

LISTVIEW_URL = "https://sf.jikji.org/book/listview.html"
BASE_URL = "https://sf.jikji.org/book/"

# 표지 이미지: 목록/그리드용 작은 버전과, 상세보기용 큰 버전 두 가지가 있습니다
# (사용자가 실제 페이지에서 확인: /book/cover/01s.jpg = 작게, /book/cover/01.jpg = 크게)
COVER_URL_TMPL = "https://sf.jikji.org/book/cover/{code}s.jpg"
COVER_LARGE_URL_TMPL = "https://sf.jikji.org/book/cover/{code}.jpg"

# 커버 이미지를 못 찾을 때(사이트 접속 실패 등)를 대비한 대체 이미지
DEFAULT_COVER = (
    "https://images.unsplash.com/photo-1543002588-bfa74002ed7e"
    "?w=200&auto=format&fit=crop&q=60"
)

TITLE_HREF_RE = re.compile(r"^b\d+\.html$", re.IGNORECASE)
AUTHOR_HREF_RE = re.compile(r"^a\d+\.html$", re.IGNORECASE)
PDF_HREF_RE = re.compile(r"pdf/.*\.pdf$", re.IGNORECASE)
# pdf 파일명에서 카탈로그 코드 추출 (예: pdf/01.pdf -> "01", pdf/e01.pdf -> "e01")
CATALOG_CODE_RE = re.compile(r"([A-Za-z0-9]+)\.pdf$", re.IGNORECASE)
ENGLISH_TITLE_RE = re.compile(r"\(([^)]+)\)")


class JikjiSFMetadataProvider(BaseMetadataProvider):
    """직지 프로젝트 SF 목록 대시보드 위젯."""

    id = "jikji_sf"
    name = "직지 프로젝트 SF 목록"
    is_searchable = False
    config_schema = [
        {
            "key": "CACHE_HOURS",
            "label": "목록 캐시 유지 시간(시간)",
            "type": "number",
            "default": 6,
        },
    ]
    dashboard_widget = {
        "title": "직지 프로젝트 SF",
        "subtitle": "아이디어 회관 SF 총서 전자책 목록 (sf.jikji.org)",
        "provider": "직지 프로젝트",
        "icon": "fa-solid fa-rocket",
        "limit": 8,
    }
    # 코어 좌측/상단 "카테고리" 내비게이션에 별도 메뉴로 노출되는 풀페이지 탭.
    # index.html/style.css/script.js 번들이 있으면 그 커스텀 UI로 렌더링되고,
    # 데이터는 get_dashboard_data()를 그대로 재사용합니다.
    category_tab = {
        "title": "직지 프로젝트 SF",
        "icon": "fa-solid fa-rocket",
        "order": 91,
    }

    _cache_items = None
    _cache_at = 0.0

    def search(self, db_type, query):
        return []

    def apply(self, db_type, book_id, item_data):
        return False, "이 플러그인은 대시보드 목록 전용이며 메타데이터 적용을 지원하지 않습니다."

    # ------------------------------------------------------------------
    # 내부 구현
    # ------------------------------------------------------------------

    def _cache_hours(self, db_type):
        cfg = self.get_plugin_config(db_type, default={}) or {}
        try:
            hours = float(cfg.get("CACHE_HOURS") or 6)
        except (TypeError, ValueError):
            hours = 6.0
        return max(0.5, hours)

    def _fetch_items(self, db_type, limit=200):
        cache_ttl = self._cache_hours(db_type) * 3600
        now = time.time()

        if self._cache_items is not None and (now - self._cache_at) < cache_ttl:
            return {"success": True, "items": self._cache_items[: max(1, int(limit or 200))]}

        try:
            resp = requests.get(LISTVIEW_URL, timeout=15)
            resp.raise_for_status()
            # 원본 페이지는 EUC-KR 인코딩입니다.
            resp.encoding = resp.apparent_encoding or "euc-kr"
            html = resp.text
        except Exception as exc:  # noqa: BLE001
            # 사이트 접속 실패 시, 이전에 캐시된 목록이 있으면 그거라도 반환
            if self._cache_items:
                return {"success": True, "items": self._cache_items[: max(1, int(limit or 200))]}
            return {"success": False, "error": f"목록을 불러오지 못했습니다: {exc}"}

        items = self._parse_listview(html)
        if items:
            self._cache_items = items
            self._cache_at = now

        return {"success": True, "items": items[: max(1, int(limit or 200))]}

    def _parse_listview(self, html):
        soup = BeautifulSoup(html, "html.parser")
        items = []
        seen_links = set()

        for row in soup.find_all("tr"):
            title_a = row.find("a", href=TITLE_HREF_RE)
            if not title_a:
                # PDF/HWP만 있고 제목 링크가 없는 (단편 모음 하위) 행은 건너뜁니다.
                continue

            detail_href = title_a.get("href", "").strip()
            if not detail_href or detail_href in seen_links:
                continue

            # 제목 셀 전체 텍스트에서 (영문 원제)를 추출합니다.
            # (title_a는 보통 <b><a>...</a></b> 형태라 부모의 부모인 <td>까지 올라가야 함)
            title_td = title_a.find_parent("td") or title_a.parent
            cell_text = title_td.get_text(" ", strip=True) if title_td else title_a.get_text(strip=True)
            kor_title = title_a.get_text(strip=True)

            eng_match = ENGLISH_TITLE_RE.search(cell_text)
            eng_title = eng_match.group(1).strip() if eng_match else ""

            display_title = kor_title
            if eng_title:
                display_title = f"{kor_title} ({eng_title})"

            pdf_a = row.find("a", href=PDF_HREF_RE)
            author_a = row.find("a", href=AUTHOR_HREF_RE)

            pdf_href = pdf_a["href"].strip() if pdf_a and pdf_a.get("href") else ""
            pdf_url = BASE_URL + pdf_href if pdf_href else ""
            detail_url = BASE_URL + detail_href

            # 카탈로그 코드(01, 40, e01 등)는 pdf 파일명에서 추출합니다.
            # (목록 페이지의 [번호] 표기가 없는 항목도 있어 이 방식이 더 안정적입니다.)
            code_match = CATALOG_CODE_RE.search(pdf_href)
            catalog_code = code_match.group(1) if code_match else ""
            cover_url = COVER_URL_TMPL.format(code=catalog_code) if catalog_code else DEFAULT_COVER
            cover_large_url = COVER_LARGE_URL_TMPL.format(code=catalog_code) if catalog_code else ""

            author_name = author_a.get_text(strip=True) if author_a else "저자 미상"

            # 다운로드 링크가 있으면 PDF를 우선 열고, 없으면 상세 페이지로 이동합니다.
            link = pdf_url or detail_url

            publisher = f"No.{catalog_code}" if catalog_code else "직지 프로젝트"

            items.append(
                {
                    "title": display_title,
                    "author": author_name,
                    "publisher": publisher,
                    "pubDate": "",
                    "cover": cover_url,
                    "cover_large": cover_large_url,
                    "link": link,
                    "catalog_code": catalog_code,
                    "description": f"상세 페이지: {detail_url}",
                }
            )
            seen_links.add(detail_href)

        return items

    def get_dashboard_data(self, db_type, limit=200):
        return self._fetch_items(db_type, limit=limit)
