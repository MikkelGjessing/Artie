# Artie – Manual Test Cases

These tests verify the extension behaviour end-to-end and can be run
without any automated test framework — just a browser with Developer Tools open.

---

## Setup

1. Load the extension unpacked (see README).
2. Open Chrome DevTools on each test page to watch for `[Artie]` console messages.
3. Check the Downloads shelf / `chrome://downloads` to verify saved files.

---

## TC-01 · Overlay injection

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to any plain article (e.g. `https://en.wikipedia.org/wiki/World_Wide_Web`). | Page loads normally. |
| 2 | Click the Artie toolbar icon. | A small floating panel appears in the bottom-right corner. |
| 3 | Verify the overlay contains: title bar "📄 Artie", "Save Page" button, status area, and "✕" close button. | All elements present. |
| 4 | Click the toolbar icon a second time. | The overlay is dismissed with a fade-out animation. |
| 5 | Click the toolbar icon a third time. | The overlay reappears. |

---

## TC-02 · Close button

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | With the overlay visible, click **✕**. | Overlay fades out and is removed from the DOM. |
| 2 | Open DevTools → Elements; search for `__artie_overlay_host__`. | Element is absent. |

---

## TC-03 · Drag behaviour

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | With the overlay visible, click-and-drag the title bar. | Overlay moves smoothly with the cursor. |
| 2 | Drag to a corner near the edge of the viewport. | Overlay stops at the viewport boundary and does not go off-screen. |
| 3 | Release the mouse. | Overlay stays in the new position. |

---

## TC-04 · Save Page – article with images

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to `https://www.bbc.com/news` and open a news article. | |
| 2 | Open the overlay and click **Save Page**. | Status changes: *Extracting content…* → *Embedding images…* → *Saving…* → *✓ Saved "…"*. |
| 3 | Open the downloaded `.html` file in a new tab. | Readable article content is shown with some embedded images. Header contains title, date saved, and source URL. |
| 4 | Disconnect from the internet (or use DevTools → Network → Offline). Open the saved file. | Page still renders correctly; embedded images display; non-embedded images are broken (expected). |

---

## TC-05 · Save Page – Wikipedia article (many images)

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to `https://en.wikipedia.org/wiki/Apollo_11`. | |
| 2 | Click **Save Page**. | Status shows "Embedding images…" for a few seconds. |
| 3 | Check the status message after completion. | Reports number of embedded images and how many (if any) failed. |
| 4 | Open saved file offline. | Main text and infobox are preserved; most Wikipedia images are embedded (CORS usually permits). |

---

## TC-06 · Save Page – CORS-restricted images

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to a page known to block CORS image fetches (e.g. a newspaper with CDN images). | |
| 2 | Open DevTools Console before saving. | |
| 3 | Click **Save Page**. | Console shows `[Artie] Could not embed image: …` warnings for each blocked image. |
| 4 | Status text reports the failed count, e.g. *… (3 images not embedded)*. | |
| 5 | Open the saved file. | Page renders; affected images appear broken (original URL kept) — no crash. |

---

## TC-07 · Save Page – minimal / no main content

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to `https://example.com`. | |
| 2 | Click **Save Page**. | Save completes without error. |
| 3 | Open the saved file. | Shows "Example Domain" heading and paragraph text. No crashes. |

---

## TC-08 · Save Page – status on error

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Manually break `modules/extractor.js` (e.g. add a `throw new Error('test')` at the top). | |
| 2 | Reload the extension and navigate to any page. | |
| 3 | Click **Save Page**. | Status shows red error text: *Error: test*. Button re-enables after. |
| 4 | Revert the change. | Normal operation resumes. |

---

## TC-09 · Style isolation (Shadow DOM)

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to a page with aggressive global CSS (e.g. a page that sets `* { font-size: 40px !important; color: red; }`). | Page looks broken. |
| 2 | Open the Artie overlay. | The overlay looks normal — its styles are unaffected by the page CSS. |
| 3 | Inspect the overlay in DevTools → Elements. | A `#shadow-root (open)` is present; overlay CSS is scoped inside it. |

---

## TC-10 · Pre-existing-tab injection fallback

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Open a tab and navigate to any article *before* loading the extension. | |
| 2 | Load the extension unpacked. | |
| 3 | Return to the pre-existing tab and click the Artie icon. | Background falls back to `chrome.scripting.executeScript`; overlay appears normally after ~100 ms. |

---

## TC-11 · Filename format

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to a page with a long or special-character title (e.g. `"Hello: World < Test > 2024"`). | |
| 2 | Click **Save Page**. | Filename uses underscores for special characters, e.g. `Hello__World___Test___2024_2024-01-15.html`, and does not cause a download error. |

---

## TC-12 · Restricted pages (should not crash)

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Navigate to `chrome://extensions`. | |
| 2 | Click the Artie toolbar icon. | Nothing happens (extension cannot run on `chrome://` pages — Chrome silently blocks it). No errors in the service-worker DevTools console beyond an expected "Could not establish connection" message. |
