# TokenWise: Complete Reality Check & Cursor/Antigravity Prompts

## The Brutal Diagnosis

I've read every line of your docs (`THE_HONEST_TRUTH.md`, `PRODUCTION_AUDIT.md`, `MANUAL_TESTING_GUIDE.md`, `CODE_REVIEW_FINAL.md`), studied all 19 screenshots across the `chatgpt/`, `claude/`, and `gemini/` folders, and deep-dived into **all 16 source files** across `src/content/`, `src/utils/`, `src/background/`, and `src/popup/`.

> [!CAUTION]
> **You have ~5,000 lines of TypeScript that previous AI agents wrote, plus 40,000+ words of audit documentation from other AI agents telling you to fix things manually. But the actual product has never been validated end-to-end on any platform. One of the three content scripts doesn't even compile. You're drowning in meta-documents about the project instead of actually fixing the project.**

---

## What You Actually Have (Not What the Docs Say)

| Layer | Reality |
|-------|---------|
| **Tokenizer** | ✅ Solid. `js-tiktoken` for GPT, heuristic for Claude/Gemini. Works. |
| **Widget UI** | ✅ Exists. Dark glassmorphic widget, draggable, dismissable. Looks decent. |
| **Input monitoring** | ⚠️ Probably works for ChatGPT (`#prompt-textarea`). Claude has 8+ fallback selectors (smart for SPA). Gemini uses `.ql-editor` (plausible). |
| **Message scanning** | ⚠️ ChatGPT uses `[data-message-author-role]` — real attribute, should work. Claude uses `.font-claude-response` — real class. Gemini uses `message-content` custom element — plausible. |
| **Attachment detection** | ❌ **Completely broken** on all 3 platforms. Selectors don't match real DOM. |
| **Model detection** | ❌ Hardcoded as `gpt-4o` / `claude-sonnet` / `gemini-pro`. Wrong if user switches models. |
| **Error reporting** | ✅ Infrastructure exists (`error-reporter.ts`). Only `chatgpt.ts` actually calls it. Claude and Gemini import it but never use it. |
| **Popup** | ✅ Surprisingly good. Dark theme, stats grid, mini bar chart, settings toggles, 2-second auto-refresh. |
| **Build** | ⚠️ Builds, but **each content script is ~5.4 MB** because `js-tiktoken` bundles the full BPE encoding data. |
| **Tests** | ❌ Zero runnable tests. `test-suite.ts` is manual smoke-test functions, not actual jest tests. |
| **Service worker** | ✅ Well-built. Message schema validation, sender ID verification, rejects external messages, persists state to survive restarts. |
| **Storage** | ✅ Excellent. Fully typed wrappers with FIFO eviction, error handling, and type-safe get/set. |
| **Prompt analyzer** | ✅ Impressively thorough — 55+ filler patterns, redundancy detection, even Gen-Z internet filler (`ngl`, `tbh`, `lowkey`). |

---

## 🚨 CRITICAL FINDING: `claude.ts` WON'T COMPILE

> [!WARNING]
> **None of the 4 existing audit documents caught this.** The `claude.ts` content script has **3 missing imports** that will cause TypeScript/esbuild compilation errors:
>
> 1. `generateFileTooltip` — called on line ~427 but **never imported** (imported in chatgpt.ts but not claude.ts)
> 2. `findComposerInput` — called on line ~106 but **not in the import block** (function exists in dom-monitor.ts)
> 3. `ExportMessage` type — used on line ~235 but **never imported**
>
> **This means the previous "✅ Clean build, no new errors" claim in your docs is likely false**, or these files were added after the last successful build.

---

## Deep Code Analysis (All 3 Content Scripts)

### chatgpt.ts — 762 lines — **BEST of the three**
| Aspect | Status |
|--------|--------|
| Compiles? | ✅ Yes |
| Error reporting | ✅ Structured `reportError()` calls with error codes |
| Heartbeat | ✅ 5-second interval health check |
| Selectors | ⚠️ Input selector real (`#prompt-textarea`), attachment selector wrong |
| Thresholds | ❌ Hardcoded (8000/30000) — not configurable from settings |
| Model | ❌ Hardcoded `gpt-4o` |

### claude.ts — 589 lines — **HAS COMPILATION BUGS**
| Aspect | Status |
|--------|--------|
| Compiles? | ❌ **No** — 3 missing imports |
| Error reporting | ❌ Imports `reportError` but never calls it — all `catch {}` |
| Heartbeat | ❌ None |
| Selectors | ⚠️ Input selectors look real (ProseMirror-based), attachments wrong |
| Thresholds | ✅ Reads from `chrome.storage` (better than chatgpt.ts!) |
| Model | ❌ Hardcoded `claude-sonnet` |
| Unique strength | ✅ `setupComposerWatcher()` — handles Claude SPA navigation well |

### gemini.ts — 648 lines — **MOST FRAGILE**
| Aspect | Status |
|--------|--------|
| Compiles? | ⚠️ Likely, but passes extra args to `safeQuerySelector` — may cause silent bugs |
| Error reporting | ❌ Imports `reportError` but never calls it — all `catch {}` |
| Heartbeat | ❌ None |
| Selectors | ❌ Most speculative of all three |
| Shadow DOM | ✅ Has `findInShadowRoots()` with depth-8 recursion — well implemented |
| Model | ❌ Hardcoded `gemini-pro` |
| Unique weakness | ⚠️ Fallback message extraction uses alternating `i % 2` pattern — fragile |

---

## Cross-Cutting Issues Found in the Codebase

| Issue | Where | Impact |
|-------|-------|--------|
| **Duplicate function** | `safeQuerySelectorAll()` exists in BOTH `dom-monitor.ts` AND `attachment-detector.ts` with different signatures | Confusing, could cause import conflicts |
| **Inconsistent constants** | `HEURISTIC_CHARS_PER_TOKEN = 3.8` in tokenizer.ts vs `CHARS_PER_TOKEN_TEXT = 4` in media-estimator.ts | ~5% token count discrepancy between text counting and file estimation |
| **Unused scaffolding** | `health-check.ts` exports `isContentScriptHealthy()` and `formatHealthStatus()` — **nothing in the project imports these** | Dead code. Service worker doesn't use heartbeat monitoring |
| **Mixed source/dist paths** | manifest.json popup points to `src/popup/popup.html` but popup.html loads `/dist/popup/popup.js` | Works but fragile, easy to forget to rebuild |
| **`chart.js` is a runtime dep** | Listed in `dependencies` but only used in analytics page (bundled by esbuild) | Should be `devDependencies` — cosmetic issue |

---

## What Your Screenshots Actually Reveal

You've already done the hardest research — inspecting real DOM structures. Here's what each folder tells us:

### ChatGPT Screenshots (4 images)

| Screenshot | Key Selectors Found |
|-----------|-------------------|
| `chatgpt attachment selector.png` | File tiles: `div[role="group"][aria-label="BD-3487.jpg"]` with class `group/file-tile text-token-text-primary` |
| `chat gpt pdf selector i guess.png` | PDF: `div[role="group"][aria-label="ilovepdf_merged (3)(2).pdf"]`, button with `aria-label` matching filename |
| `chatgpt inputs.png` | File inputs: `id="upload-photos"` with `data-testid="upload-photos-input"`, separate file input for documents |
| `chatgpt ai output.png` | AI text: `div.markdown.prose` with `<p data-start="0" data-end="9">` containing text |

**Bottom line:** ChatGPT attachments use `role="group"` + `aria-label` with the filename. NOT `data-testid="attachment"`.

### Claude Screenshots (5 images)

| Screenshot | Key Selectors Found |
|-----------|-------------------|
| `normal claude output selector.png` | Response text: `<p class="font-claude-response-body break-words whitespace-normal">` |
| `claude code block selector.png` | Code blocks: `div[role="group"][aria-label="python code"]` → `pre.code-block__code`, message container: `div[data-test-render-count]` |
| `claude text files but i dont know...png` | Artifacts: `div.artifact-block-cell`, file buttons with `aria-label="View    init   "` |
| `file creation in claude .png` | Status: `span[role="status"]` "Created 9 files, ran a command", file list with `button.group/row` |
| `claude code structured output.png` | Tab panels: `div#tab-workflow.panel.active`, `div#tab-problems`, `div#tab-data`, `div#tab-steps` |

**Bottom line:** Claude file artifacts use `.artifact-block-cell` class. NOT `data-testid="file-thumbnail"`.

### Gemini Screenshots (10 images)

| Screenshot | Key Selectors Found |
|-----------|-------------------|
| `gemini attachment selector 1.png` | Image attachment: `<img alt="attachment" class="gem-attachment-style-img">` inside `span.mdc-evolution-chip__text-label` |
| `gemini pdf attachment.png` | PDF: `<gem-attachment class="gem-attachment gds-label-l gem-attachment-tile lm-enabled">` → `<mat-basic-chip>` |
| `gemini excel sheet selector.png` | Same `<gem-attachment>` pattern with `<mat-basic-chip id="mat-mdc-chip-5">` |
| `gemini normal model text response.png` | Response: `<model-response>` → `<response-container>` → `<message-content id="message-content-id-r_...">` → `div.markdown` |
| `gemini code container.png` | Code: `<code data-test-id="code-content" class="code-container formatted">` |
| `gemini simulation generator...png` | Canvas/apps: `<web-preview data-test-id="preview-block">` → sandboxed `<iframe>` |

**Bottom line:** Gemini uses `<gem-attachment>` custom elements and `<mat-basic-chip>`. NOT `.file-chip` or `.upload-chip`.

---

## Cursor/Antigravity Prompts (Copy-Paste Ready)

Each prompt is scoped to stay within AI agent context limits. **Do them in this order.**

---

### 🔴 PROMPT 0: Fix claude.ts Compilation (DO THIS FIRST)

```
CONTEXT: I'm building a Chrome extension called TokenWise. The file 
src/content/claude.ts has 3 missing imports that prevent compilation.

TASK: Fix the import statements in src/content/claude.ts

1. Add `generateFileTooltip` to the import from '../utils/media-estimator'
   Current import line looks like:
   import { estimateFileTokens, detectURLs, type FileEstimate } from '../utils/media-estimator';
   Change to:
   import { estimateFileTokens, detectURLs, generateFileTooltip, type FileEstimate } from '../utils/media-estimator';

2. Add `findComposerInput` to the import from '../utils/dom-monitor'
   Add findComposerInput to the existing dom-monitor import block.

3. Add `type ExportMessage` to the import from '../utils/context-exporter' 
   or from '../utils/widget-ui' — check where it's exported from and add 
   the import.

Also while you're in claude.ts:
- Add actual reportError() calls in the catch blocks that currently say 
  "// Fail silently". Follow the same pattern used in chatgpt.ts:
  ```
  catch (e) {
    await reportError('claude', 'ERROR_CODE', 'Description', undefined, 
      e instanceof Error ? e : undefined);
  }
  ```
- Make sure the init() outer catch reports errors like chatgpt.ts does

After fixing, run: npm run build
Verify it compiles with zero errors.
DO NOT change any selectors or logic — only fix imports and add error reporting.
```

---

### 🔴 PROMPT 1: Fix ChatGPT Attachment Selectors

```
CONTEXT: I'm building a Chrome extension called TokenWise that monitors token 
usage on AI chat platforms. The DOM selectors in src/utils/dom-monitor.ts are 
wrong for ChatGPT file attachments and don't match the real DOM.

TASK: Update the ChatGPT config in SITE_CONFIGS inside src/utils/dom-monitor.ts.

Here are the REAL selectors from ChatGPT's DOM (June 2026, confirmed via 
DevTools inspection):

INPUT FIELD:
- #prompt-textarea — this is CORRECT, keep it as-is

MESSAGES:
- [data-message-author-role] — this is CORRECT, keep it
- AI text content is inside: div.markdown (class includes "markdown prose")

FILE ATTACHMENTS (CRITICAL FIX — current selector is WRONG):
- The OLD selector [data-testid="attachment"] does NOT exist in ChatGPT's DOM
- Real file attachment tiles are: div elements with role="group" and an 
  aria-label containing the filename (e.g., aria-label="BD-3487.jpg")
- They have CSS classes containing "group/file-tile" and 
  "text-token-text-primary"
- Parent container has class "horizontal-scroll-fade-mask"
- Images inside tiles use class containing "object-cover"
- NEW fileAttachmentSelector should be:
  'div[role="group"][aria-label][class*="file-tile"], div[role="group"][class*="file-tile"], [class*="file-tile"][class*="text-token-text-primary"]'

ALSO update src/content/chatgpt.ts detectAttachments() function:
- Currently tries to read data-filename attribute — ChatGPT doesn't use this
- Instead, get filename from the element's aria-label attribute:
  let fileName = el.getAttribute('aria-label') || el.getAttribute('title');
- File size is NOT available in ChatGPT's DOM, so estimate from filename 
  extension only (this already works via the estimateFileTokens fallback)
- For images, get dimensions from the <img> child element (this part works)

DO NOT touch claude.ts or gemini.ts in this prompt.
After changes, run: npm run build
```

---

### 🔴 PROMPT 2: Fix Claude Selectors

```
CONTEXT: TokenWise Chrome extension. I need to fix the Claude (claude.ai) 
DOM selectors in src/utils/dom-monitor.ts and src/content/claude.ts.

REAL CLAUDE DOM (June 2026, from DevTools inspection):

INPUT FIELD:
- div.ProseMirror[contenteditable="true"] — CORRECT, keep the existing 
  multi-fallback approach

MESSAGES (keep existing, they look correct):
- User: [data-testid="user-message"], .font-user-message
- Assistant: .font-claude-response, [data-testid="assistant-message"]
- Message container: div[data-test-render-count]

FILE ATTACHMENTS (CRITICAL FIX):
- Claude uses "artifacts" not traditional file attachments
- Artifact containers: div.artifact-block-cell
- Artifact action buttons inside have aria-label with artifact name 
  (e.g., aria-label="View    init   ")
- File creation status: span[role="status"] with text like 
  "Created 9 files, ran a command"
- Code artifacts: div[role="group"][aria-label*="code"] containing 
  pre.code-block__code
- The OLD selector [data-testid="file-thumbnail"] does NOT work
- NEW fileAttachmentSelector should be:
  '.artifact-block-cell, div[class*="artifact-block"], [data-testid="file-thumbnail"], [data-testid="image-thumbnail"]'

CHAT CONTAINER:
- Messages are inside div.contents under div[data-test-render-count]
- Update chatContainerSelector to: 
  'div[data-test-render-count], [data-testid="conversation"], main'

Update SITE_CONFIGS.claude in dom-monitor.ts with these selectors.
Update detectAttachments() in claude.ts to handle artifacts:
- For artifact-block-cell elements, look for button[aria-label] inside
- Extract artifact name from the aria-label (trim whitespace)
- Estimate as code/text file tokens

DO NOT touch chatgpt.ts or gemini.ts.
After changes, run: npm run build
```

---

### 🔴 PROMPT 3: Fix Gemini Selectors

```
CONTEXT: TokenWise Chrome extension. Gemini (gemini.google.com) uses Angular 
with custom web components. I need to fix selectors in 
src/utils/dom-monitor.ts and src/content/gemini.ts.

REAL GEMINI DOM (June 2026, from DevTools inspection):

INPUT FIELD:
- .ql-editor — CORRECT for Quill-based editor, keep it

MESSAGES:
- Response containers: model-response (custom element, no dot — it's a tag name)
- Inside: response-container → presented-response-container → 
  response-container-content
- Text content: message-content (custom element) with IDs like 
  "message-content-id-r_aa9963c26833bb76"
- Actual text in: div.markdown.markdown-main-panel
- User queries: user-query (custom element)
- Conversation container: div.conversation-container with real IDs
- Update messageSelector to:
  'message-content, model-response, .response-container-content, .model-response-text'

FILE ATTACHMENTS (CRITICAL FIX):
- Gemini uses custom element: <gem-attachment> with class 
  "gem-attachment gds-label-l gem-attachment-tile lm-enabled"
- Inside: <mat-basic-chip> with id pattern "mat-mdc-chip-N"
- Image attachments: <img alt="attachment" class="gem-attachment-style-img">
- Attachment content label: span.gem-attachment-content
- The OLD selectors .file-chip and .upload-chip are WRONG
- NEW fileAttachmentSelector:
  'gem-attachment, .gem-attachment, img.gem-attachment-style-img, [class*="gem-attachment"]'

CODE BLOCKS:
- code[data-test-id="code-content"].code-container

IMPORTANT: The shadowDom flag is true in config. But Gemini's custom elements 
(gem-attachment, model-response, message-content) may NOT use shadow DOM 
internally — they might be plain custom element tag names without shadow roots.
The existing findInShadowRoots() should handle both cases, but make sure the 
selectors work with normal querySelector first, and shadow DOM traversal 
as fallback.

Also in gemini.ts:
- Add actual reportError() calls in catch blocks (currently all silent)
- Fix the extractGeminiMessages() function — the alternating i%2 role 
  assignment is fragile. Instead, check for parent/ancestor element type:
  if inside <user-query> → role 'user', if inside <model-response> → 
  role 'assistant'

DO NOT touch chatgpt.ts or claude.ts.
After changes, run: npm run build
```

---

### 🟡 PROMPT 4: Fix the 5.4 MB Bundle Size

```
CONTEXT: TokenWise Chrome extension. Each of the 3 content scripts builds to 
~5.4 MB because js-tiktoken bundles the entire BPE vocabulary data (o200k_base 
and cl100k_base encodings are massive JSON blobs). Total: 16.2 MB of JS 
injected. Chrome Web Store will likely flag this. Users will feel the lag.

TASK: Reduce bundle size using this approach:

Claude and Gemini DON'T NEED tiktoken — they use heuristic counting anyway 
(chars / 3.8). Only ChatGPT models (GPT-4, GPT-4o, etc.) need BPE tokenization.

Step 1: Create src/utils/tokenizer-lite.ts
- Export the same interface as tokenizer.ts (countTokens, estimateConversationTokens, etc.)
- But ONLY use the heuristic method (chars / 3.8) — never import js-tiktoken
- This file should be tiny (< 50 lines)

Step 2: Update claude.ts and gemini.ts
- Change their import from '../utils/tokenizer' to '../utils/tokenizer-lite'
- They never used BPE encoding anyway — this changes nothing functionally

Step 3: Keep chatgpt.ts importing from '../utils/tokenizer' (the full one)

Step 4: Also check if media-estimator.ts and prompt-analyzer.ts import from 
tokenizer. If they only use quickEstimate or heuristic functions, point them 
at tokenizer-lite too. Be careful — media-estimator uses estimateImageTokens 
which doesn't need tiktoken, so it can use the lite version.

Step 5: Fix the inconsistency — tokenizer.ts uses HEURISTIC_CHARS_PER_TOKEN=3.8 
but media-estimator.ts uses CHARS_PER_TOKEN_TEXT=4. Pick one value (3.8) and 
use it everywhere.

After changes, run: npm run build
Report the file sizes of all outputs in dist/.
Target: claude.js and gemini.js should be < 200 KB each.
```

---

### 🟡 PROMPT 5: Add Real Unit Tests

```
CONTEXT: TokenWise Chrome extension. jest.config.js exists but there are zero 
test files. The existing test-suite.ts in src/utils/ is manual smoke tests, 
not jest tests. I need actual runnable unit tests.

TASK: Create jest unit tests. The tests should NOT require a browser or DOM.

1. tests/tokenizer.test.ts
   - Test countTokens('Hello world', 'gpt-4o') returns reasonable count (2-3)
   - Test countTokens('', 'gpt-4o') returns { tokens: 0, characters: 0 }
   - Test with string over 100,000 chars gets capped
   - Test heuristic fallback for 'claude-sonnet' model
   - Test estimateImageTokens(1024, 1024, 'high') returns correct tile calc
   - Test estimateImageTokens(0, 0) returns 0
   - Test estimateConversationTokens with sample messages

2. tests/media-estimator.test.ts
   - Test estimateFileTokens('doc.pdf', 10240) returns reasonable estimate
   - Test estimateFileTokens('image.png', 0, '', 800, 600) handles images
   - Test detectURLs('check out https://example.com') finds URL
   - Test generateFileTooltip returns string with filename

3. tests/prompt-analyzer.test.ts
   - Test analyzePrompt('I just wanted to say hello') detects filler
   - Test analyzePrompt('') returns empty suggestions
   - Test applySuggestion correctly replaces text
   - Test getTotalSavings sums up savings

4. tests/error-reporter.test.ts
   - Mock chrome.storage.local (create a __mocks__/chrome.ts or use 
     jest.fn() to mock chrome.storage.local.get and .set)
   - Test reportError stores error
   - Test clearErrorReports clears storage

Also update jest.config.js to handle TypeScript:
- Ensure ts-jest transform is configured
- Add moduleNameMapper if needed for path aliases
- Set testEnvironment to 'node'

After creating tests, run: npm test
Fix any failures. All tests must pass.
```

---

### 🟢 PROMPT 6: Model Detection from DOM

```
CONTEXT: TokenWise Chrome extension. All 3 content scripts hardcode their 
model type (gpt-4o, claude-sonnet, gemini-pro). This means token estimates 
are wrong when users switch models.

TASK: Create src/utils/model-detector.ts

Export: detectModel(site: SiteName): ModelType

For ChatGPT:
- Look for model name in the UI — ChatGPT shows it in header or dropdown
- Try: button text near top of page, [data-testid*="model"], any element 
  showing "GPT-4o", "GPT-4o mini", etc.
- Map display names: "GPT-4o" → 'gpt-4o', "GPT-4o mini" → 'gpt-4o', 
  "GPT-3.5" → 'gpt-3.5-turbo', "o1" → 'gpt-4o'
- Default: 'gpt-4o'

For Claude:
- Claude shows model in header area or settings
- Map: "Sonnet" → 'claude-sonnet', "Opus" → 'claude-opus', 
  "Haiku" → 'claude-haiku'
- Default: 'claude-sonnet'

For Gemini:
- Gemini shows model in a dropdown/selector
- Map: contains "Flash" → 'gemini-flash', contains "Pro" → 'gemini-pro', 
  contains "Ultra" → 'gemini-ultra'
- Default: 'gemini-pro'

Implementation:
- Use try/catch everywhere — if detection fails, return default
- Query DOM text content, not just attributes
- For Gemini, try both normal and shadow DOM queries

Then update each content script:
- In chatgpt.ts: replace `const MODEL: ModelType = 'gpt-4o'` with 
  `let MODEL: ModelType = detectModel('chatgpt')`
- Re-run detection in the chat observer callback (user might switch mid-chat)
- Same for claude.ts and gemini.ts

After changes, run: npm run build
```

---

### 🟢 PROMPT 7: Cleanup and Integration Build

```
CONTEXT: TokenWise Chrome extension. After applying previous fixes, I need 
a final cleanup pass.

TASK: Do a final integration cleanup:

1. REMOVE DEAD CODE:
   - src/utils/test-suite.ts — manual smoke tests, superseded by jest tests
   - The duplicate safeQuerySelectorAll() in attachment-detector.ts — it should 
     import from dom-monitor.ts instead of having its own copy
   - Unused import of extractMessages in gemini.ts (it uses extractGeminiMessages)

2. UNIFY THRESHOLDS:
   - chatgpt.ts and gemini.ts hardcode warningThreshold: 8000 and 
     criticalThreshold: 30000
   - claude.ts reads these from chrome.storage settings
   - Make all 3 read from storage like claude.ts does
   - The defaults in storage.ts are already 8000/30000, so behavior is unchanged

3. ADD HEARTBEAT TO CLAUDE & GEMINI:
   - chatgpt.ts has setupHeartbeat() (5-second interval sending health check)
   - claude.ts and gemini.ts don't have this
   - Copy the heartbeat pattern from chatgpt.ts to the other two

4. WIRE UP HEALTH CHECK:
   - health-check.ts exports isContentScriptHealthy() and formatHealthStatus()
   - Nothing in the project uses these
   - In service-worker.ts, import and use them: when responding to GET_STATS, 
     include health status based on heartbeat recency

5. CLEAN UP DOCUMENTATION:
   - Delete or archive these files that are now outdated:
     THE_HONEST_TRUTH.md, PRODUCTION_AUDIT.md, MANUAL_TESTING_GUIDE.md, 
     CODE_REVIEW_FINAL.md, CHECK_CHROME_STORAGE.md
   - Update README.md with accurate current state

6. VERIFY BUILD:
   - Run: npm run build
   - Run: npm test
   - Check all dist/ output sizes
   - Ensure zero TypeScript errors

After all changes, run: npm run build && npm test
Everything must pass.
```

---

## The Realistic Shipping Plan

> [!IMPORTANT]
> **Stop reading audit docs. Start fixing code. Prompt 0 first — claude.ts literally doesn't compile.**

### Phase 0: Can It Even Build? (30 min)
Run Prompt 0. Fix the missing imports. Verify `npm run build` succeeds. This is prerequisite to everything.

### Phase 1: Make It Work on ONE Platform (3-4 hours)
Pick ChatGPT. Run Prompt 1. Load the extension. Does the widget show up? Do token counts update as you type? That's your MVP validation.

### Phase 2: Fix the Other Two (2-3 hours)
Run Prompts 2 and 3. Test each platform manually for 10 minutes each.

### Phase 3: Fix Bundle Size (1-2 hours)
Run Prompt 4. Get content scripts under 200 KB for Claude/Gemini.

### Phase 4: Add Safety Net (1-2 hours)
Run Prompt 5. Get unit tests passing. This prevents future regressions.

### Phase 5: Polish (2-3 hours)
Run Prompts 6 and 7. Model detection + final cleanup.

### Phase 6: Ship (1 hour)
- Bump version to 1.1.0 in both `manifest.json` and `package.json`
- Update README with accurate feature list (not aspirational)
- Build final: `npm run build`
- Test final: load unpacked in Chrome, quick-test each platform
- Create Chrome Web Store listing
- Submit for review

| Phase | Effort | What You Get |
|-------|--------|-------------|
| 0. Fix compilation | 30 min | Code actually builds |
| 1. ChatGPT works | 3-4 hrs | First platform validated |
| 2. Claude + Gemini | 2-3 hrs | All platforms basic-functional |
| 3. Bundle size | 1-2 hrs | Shippable file sizes |
| 4. Unit tests | 1-2 hrs | Safety net against regressions |
| 5. Polish | 2-3 hrs | Professional quality |
| 6. Ship | 1 hr | Published on Chrome Web Store |
| **Total** | **~12-15 hours** | **v1.1.0 shipped** |

---

## The Hard Truth About Scope

> [!IMPORTANT]
> **What to ship in v1.0 vs what to defer:**
>
> **v1.0 (SHIP THIS):**
> - Widget showing input token count as you type ✅
> - Conversation total token count ✅  
> - Warning when conversation gets expensive ✅
> - Copy context for new chat button ✅
> - Popup with stats ✅
>
> **v1.1 (DEFER THIS):**
> - Attachment/file token detection (it's the hardest part and most breakable)
> - Dynamic model detection
> - Prompt optimization suggestions
>
> **v2.0 (FUTURE):**
> - Analytics dashboard with historical data
> - Automated selector resilience (multiple fallback strategies)
> - Cross-browser support

If you try to ship everything at once, you'll never ship. The core value — "see how many tokens your message costs" — works TODAY once you fix the build and verify selectors.

---

## What to Tell Yourself

1. **You have a good foundation.** The tokenizer works. The widget works. The architecture is correct. The service worker and storage layer are genuinely well-built.

2. **Previous AI agents wrote plumbing but never connected it to reality.** They created `attachment-detector.ts`, `error-reporter.ts`, `health-check.ts` — but with fabricated selectors and one file that doesn't even compile.

3. **Your screenshots ARE the goldmine.** You did the hardest research. The prompts above translate your screenshots into code changes.

4. **Stop generating more documentation.** You have 4 audit documents totaling 40,000+ words. You don't need a 5th. You need to fix the code.

5. **Ship a v1 that does ONE thing well:** Show token counts for text input. That alone is valuable and differentiating.

---

## Quick-Start (Do This Right Now)

```
Step 1: Copy Prompt 0 → paste in Cursor/Antigravity → fix compilation
Step 2: npm run build → verify zero errors
Step 3: Copy Prompt 1 → paste → fix ChatGPT selectors
Step 4: npm run build
Step 5: Load extension in Chrome (chrome://extensions → Load unpacked)
Step 6: Open chatgpt.com → type something → does widget update?
Step 7: If YES → you're 60% to shipping. Continue with Prompts 2-7.
Step 8: If NO → check DevTools console → fix the error → rebuild → retry
```

> [!TIP]
> **Each prompt is designed to be a single Cursor/Antigravity session. Don't combine them.** Run one prompt, verify the build, test manually, then move to the next. This keeps the AI agent focused and within context limits.
