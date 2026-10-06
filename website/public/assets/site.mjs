/* global document, window, HTMLElement, ResizeObserver */
const menu = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const header = document.querySelector(".site-header");
const closeMenu = () => {
  menu?.setAttribute("aria-expanded", "false");
  mainNav?.classList.remove("is-open");
};
menu?.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  mainNav?.classList.toggle("is-open", open);
});
mainNav?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
  }
});

// Keep the page still while the header leaves on downward scroll and returns on upward scroll.
if (header) {
  let lastY = Math.max(0, window.scrollY);
  let direction = 0;
  let distance = 0;
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
  }).observe(header);
  header.addEventListener("focusin", () => header.classList.remove("is-hidden"));
  window.addEventListener(
    "scroll",
    () => {
      const y = Math.max(
        0,
        Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight)
      );
      const delta = y - lastY;
      lastY = y;
      if (!delta || document.querySelector(".image-viewer[open]")) return;
      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta);
      direction = nextDirection;
      if (
        y < header.offsetHeight ||
        menu?.getAttribute("aria-expanded") === "true" ||
        header.querySelector(":focus-visible")
      ) {
        header.classList.remove("is-hidden");
      } else if (distance >= 12) {
        header.classList.toggle("is-hidden", direction > 0);
      }
    },
    { passive: true }
  );
}

function responsiveIndex(details, query) {
  if (!details) return;
  const compact = window.matchMedia(query);
  const update = () => {
    details.open = !compact.matches;
  };
  update();
  compact.addEventListener("change", update);
}

const imageLinks = document.querySelectorAll("[data-enlarge]");
if (imageLinks.length) {
  const viewer = document.createElement("dialog");
  viewer.className = "image-viewer";
  viewer.setAttribute("aria-label", "Image preview");
  viewer.innerHTML = `<div class="image-toolbar"><p id="image-caption"></p><button type="button" class="image-zoom" aria-pressed="false">Actual size</button><button type="button" class="image-close" autofocus>Close <span aria-hidden="true">×</span></button></div><div class="image-stage" tabindex="0" aria-label="Image, scroll to inspect at actual size"><img alt=""><p class="image-error" role="status" hidden>This image could not load. Close the preview and try again.</p></div>`;
  document.body.append(viewer);
  const image = viewer.querySelector("img");
  const caption = viewer.querySelector("#image-caption");
  const zoom = viewer.querySelector(".image-zoom");
  const stage = viewer.querySelector(".image-stage");
  const error = viewer.querySelector(".image-error");
  let trigger;
  zoom.addEventListener("click", () => {
    const enlarged = viewer.classList.toggle("is-zoomed");
    zoom.setAttribute("aria-pressed", String(enlarged));
    zoom.textContent = enlarged ? "Fit to window" : "Actual size";
    stage.scrollTo(0, 0);
  });
  viewer.querySelector(".image-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => {
    document.documentElement.classList.remove("image-open");
    trigger?.focus({ preventScroll: true });
  });
  image.addEventListener("error", () => {
    image.hidden = true;
    error.hidden = false;
    zoom.disabled = true;
  });
  for (const link of imageLinks) {
    link.setAttribute("role", "button");
    link.setAttribute("aria-haspopup", "dialog");
    link.addEventListener("keydown", (event) => {
      if (event.key === " ") {
        event.preventDefault();
        link.click();
      }
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      trigger = link;
      image.hidden = false;
      error.hidden = true;
      zoom.disabled = false;
      image.alt = link.querySelector("img").alt;
      caption.textContent = image.alt;
      image.src = link.href;
      viewer.classList.remove("is-zoomed");
      zoom.setAttribute("aria-pressed", "false");
      zoom.textContent = "Actual size";
      viewer.showModal();
      document.documentElement.classList.add("image-open");
      stage.scrollTo(0, 0);
    });
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
  if (
    event.key !== "/" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.querySelector(".image-viewer[open]")
  )
    return;
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
