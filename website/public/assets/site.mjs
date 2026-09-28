/* global document, window, HTMLElement, IntersectionObserver */
const menu = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  mainNav?.classList.toggle("is-open", open);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.getAttribute("aria-expanded") === "true") {
    menu.setAttribute("aria-expanded", "false");
    mainNav?.classList.remove("is-open");
    menu.focus();
  }
});

const fieldIndex = document.querySelector(".field-index details");
function responsiveIndex(details, query) {
  if (!details) return;
  const compact = window.matchMedia(query);
  const update = () => {
    details.open = !compact.matches;
  };
  update();
  compact.addEventListener("change", update);
}
responsiveIndex(fieldIndex, "(max-width: 980px)");
const chapterLinks = [...document.querySelectorAll(".field-index nav a")];
if (chapterLinks.length) {
  // The guide index answers the scroll without moving the reading surface.
  const chapterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of chapterLinks) {
          if (link.hash === `#${entry.target.id}`) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        }
      }
    },
    { rootMargin: "-10% 0px -65% 0px" }
  );
  for (const link of chapterLinks) {
    const chapter = document.querySelector(link.hash);
    if (chapter) chapterObserver.observe(chapter);
  }
}

const field = document.querySelector("#docs-search");
const results = document.querySelector("#search-results");
const status = document.querySelector("#search-status");
let indexPromise;
let searchId = 0;
async function search() {
  const requestId = ++searchId;
  const query = field.value.trim().toLocaleLowerCase();
  results.replaceChildren();
  if (!query) {
    status.textContent = "Search titles and the full text of every guide.";
    return;
  }
  status.textContent = "Searching the handbook…";
  try {
    indexPromise ??= fetch(`${document.body.dataset.base}search.json`).then((response) => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    });
    const index = await indexPromise;
    if (requestId !== searchId) return;
    const terms = query.split(/\s+/);
    const matches = index
      .map((page) => {
        const title = page.title.toLocaleLowerCase();
        const body = page.text.toLocaleLowerCase();
        const score = terms.every((term) => `${title} ${body}`.includes(term))
          ? terms.reduce((n, term) => n + (title.includes(term) ? 10 : 1), 0)
          : 0;
        return { page, score };
      })
      .filter((item) => item.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    status.textContent = matches.length
      ? `${matches.length} guide${matches.length === 1 ? "" : "s"} found${matches.length === 12 ? " (showing the first 12)" : ""}.`
      : "No guides found. Try “DDS”, “setup” or “localization”.";
    for (const { page } of matches) {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = page.url;
      const title = document.createElement("strong");
      title.textContent = page.title;
      const description = document.createElement("span");
      const position = page.text.toLocaleLowerCase().indexOf(terms[0]);
      description.textContent =
        position < 0
          ? page.description
          : `${position > 45 ? "…" : ""}${page.text.slice(Math.max(0, position - 45), position + 145)}…`;
      link.append(title, description);
      results.append(link);
    }
  } catch {
    indexPromise = undefined;
    if (requestId === searchId)
      status.textContent = "Search could not load. Try again, or browse the guides below.";
  }
}
field?.addEventListener("input", search);
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
  )
    return;
  event.preventDefault();
  if (field) field.focus();
  else window.location.href = `${document.body.dataset.base}docs/#search`;
});
if (field && window.location.hash === "#search") field.focus();
const handbookMenu = document.querySelector(".handbook-menu");
responsiveIndex(handbookMenu, "(max-width: 800px)");

// Reading progress stays separate from the document so its layout does not move.
const prose = document.querySelector(".prose");
if (prose) {
  const progress = document.createElement("div");
  progress.className = "reading-progress";
  progress.setAttribute("aria-hidden", "true");
  document.body.append(progress);
  const update = () => {
    const bounds = prose.getBoundingClientRect();
    const length = bounds.height - window.innerHeight;
    progress.style.transform = `scaleX(${length > 0 ? Math.max(0, Math.min(1, -bounds.top / length)) : 1})`;
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}
