# How to Check Chrome.Storage (Error Logs)

## Quick Answer

**In Chrome DevTools:**
1. Press `F12` (or right-click → Inspect)
2. Go to **Application** tab
3. Left sidebar → **Local Storage**
4. Find `chrome-extension://[your-extension-id]`
5. Click it
6. Look for key: `errorReports`
7. Read the value (it's a JSON array of errors)

---

## Step-by-Step (With Screenshots in Your Head)

### Step 1: Open the Extension in DevTools

**On any site where TokenWise is active (ChatGPT, Claude, Gemini):**

```
Press: F12 (or Ctrl+Shift+I on Windows)
```

DevTools opens at bottom of browser.

### Step 2: Go to Application Tab

```
Top of DevTools, click tabs: Elements | Console | Sources | Network | ...
Look for: Application (might be further right, scroll the tabs)
Click: Application
```

You should see a left sidebar with options like:
- Storage
- Session Storage
- Cookies
- Etc.

### Step 3: Expand "Local Storage"

```
Left sidebar → Local Storage (click the arrow to expand)
```

You'll see a list of URLs that have Local Storage data:
- `https://chat.openai.com`
- `https://claude.ai`
- etc.

### Step 4: Find Your Extension

```
Look for: chrome-extension://[a-long-string-of-letters]
Click it
```

That long string is your extension ID. There's only one, so it's easy to spot.

### Step 5: View Error Reports

```
You'll see a table on the right with two columns:
  Column 1: Key names
  Column 2: Values

Look for the row that says: errorReports
Click that row
```

The value will be a JSON array. It looks like:

```json
[
  {
    "id": "err-1718918400123-0",
    "site": "chatgpt",
    "type": "INPUT_ELEMENT_NOT_FOUND",
    "message": "Could not find input element after 10 seconds",
    "stack": "Error: Timeout\n    at waitForElement (content.js:245:...)",
    "timestamp": 1718918400123,
    "errorCount": 1
  },
  {
    "id": "err-1718918500456-1",
    "site": "claude",
    "type": "OBSERVER_FAILED",
    "message": "Failed to create DOM observer",
    "timestamp": 1718918500456,
    "errorCount": 1
  }
]
```

If the array is empty `[]`, no errors happened. That's good.

---

## What Each Error Field Means

| Field | Meaning |
|-------|---------|
| `id` | Unique error ID (timestamp + counter) |
| `site` | Where it happened: `chatgpt`, `claude`, or `gemini` |
| `type` | Error type code (e.g., `INPUT_ELEMENT_NOT_FOUND`) |
| `message` | Human-readable error description |
| `stack` | Stack trace (for debugging) |
| `timestamp` | Unix timestamp (milliseconds) when it happened |
| `errorCount` | How many times this same error happened |

---

## Common Error Types & What They Mean

### `INPUT_ELEMENT_NOT_FOUND`
**Problem:** Widget couldn't find the input field  
**Reason:** Selector is wrong OR page layout is different  
**Action:** Test on the site, open DevTools Inspector, find the real input selector

### `ATTACHMENT_DETECTION_FAILED`
**Problem:** Failed to find attachments  
**Reason:** Attachment selector is wrong (likely)  
**Action:** Upload a file, inspect it in DevTools, find real selector

### `OBSERVER_FAILED`
**Problem:** Failed to watch DOM for changes  
**Reason:** DOM mutation observer setup failed  
**Action:** Check browser console for JavaScript errors

### `INIT_FAILED`
**Problem:** Content script initialization failed  
**Reason:** Generic catch-all for startup errors  
**Action:** Check the `message` and `stack` fields for details

---

## Three Ways to Check Storage

### Method 1: DevTools (Easiest)

```
1. Open DevTools (F12)
2. Application tab
3. Local Storage
4. Find chrome-extension://...
5. Look for "errorReports" key
```

**Best for:** Quick checks, visual inspection

### Method 2: DevTools Console (JavaScript)

```javascript
// Paste this in DevTools Console tab:

chrome.storage.local.get('errorReports', (result) => {
  console.log('Error Reports:', result.errorReports);
});
```

**Output:**
```
Error Reports: Array(2)
  [0]: {id: "err-...", site: "chatgpt", type: "INPUT_ELEMENT_NOT_FOUND", ...}
  [1]: {id: "err-...", site: "claude", type: "OBSERVER_FAILED", ...}
```

Click the array to expand and read errors.

**Best for:** When Application tab is being weird

### Method 3: Copy-Paste to Text Editor

```javascript
// In DevTools Console:

chrome.storage.local.get('errorReports', (result) => {
  copy(JSON.stringify(result.errorReports, null, 2));
  console.log('Copied to clipboard!');
});
```

Then:
```
Ctrl+V in Notepad/VS Code
See all errors formatted nicely
```

**Best for:** Analyzing lots of errors

---

## How to Clear Error Logs

```javascript
// In DevTools Console:

chrome.storage.local.remove('errorReports', () => {
  console.log('Error logs cleared!');
});
```

**When to do this:**
- Before testing a fix
- When you want to see ONLY new errors
- After you've reviewed old errors

---

## Common Questions

**Q: Where do I find the extension ID?**

A: In DevTools → Application → Local Storage → The `chrome-extension://[ID]` part

Or go to `chrome://extensions` → Find TokenWise → The ID is shown there too

**Q: The errorReports key doesn't exist, what does that mean?**

A: Either:
1. No errors happened (good!)
2. Chrome.storage permission not granted (bad — bug in manifest)
3. Extension hasn't run yet (reload the page and try again)

**Q: Can I see errors across multiple sites?**

A: No. Each site's Local Storage is separate. Open DevTools on ChatGPT to see ChatGPT errors. Open DevTools on Claude to see Claude errors.

**Q: How long are errors kept?**

A: 7 days (then automatically deleted)

**Q: Do errors clear when I close DevTools?**

A: No. Errors stay in chrome.storage even if you close DevTools, reload the browser, etc.

**Q: Can other websites see my error logs?**

A: No. Chrome.storage is isolated per extension. Only TokenWise can access TokenWise's storage.

---

## Real-World Example

### Scenario: "I tested ChatGPT, want to see if there were errors"

```
1. Open chat.openai.com (with TokenWise loaded)
2. Press F12
3. Click Application tab
4. Click Local Storage (expand arrow)
5. Click chrome-extension://[your-extension-id]
6. Scroll down to find "errorReports" row
7. Click the value cell
8. Read the JSON array
```

**If you see:**
```json
[]
```
→ No errors! Extension is working fine.

**If you see:**
```json
[
  {
    "type": "ATTACHMENT_DETECTION_FAILED",
    "message": "Attachment selector returned empty array",
    ...
  }
]
```
→ Attachment detection is broken. Need to find real selector.

---

## Debugging Workflow

### Before Testing:
```
1. Open DevTools on ChatGPT
2. Application → Local Storage → errorReports
3. Copy the current errors (if any)
4. Clear logs: chrome.storage.local.remove('errorReports')
```

### Test:
```
1. Use TokenWise normally
2. Upload files, type messages, etc.
```

### After Testing:
```
1. Check Local Storage again
2. Any NEW errors? Compare to before
3. Read error messages
4. Debug based on error type
```

---

## Quick Troubleshooting

**Widget doesn't appear:**
```
Check errorReports for: INPUT_ELEMENT_NOT_FOUND or INIT_FAILED
If present: selector is wrong
If absent: maybe a different error, check console
```

**Attachment tokens missing:**
```
Check errorReports for: ATTACHMENT_DETECTION_FAILED
If present: attachment selector is wrong
Look at message and stack for details
```

**Extension crashes browser tab:**
```
Check errorReports for any entries
JavaScript errors might not be caught
Also check DevTools Console for red errors
```

**No errors in storage but extension isn't working:**
```
Maybe the error type isn't implemented yet
Check DevTools Console tab for errors
Look for red text or warnings
```

---

## Advanced: Monitoring Errors Automatically

```javascript
// Paste in DevTools Console to watch for NEW errors:

let lastCount = 0;

setInterval(() => {
  chrome.storage.local.get('errorReports', (result) => {
    const currentCount = result.errorReports?.length || 0;
    if (currentCount > lastCount) {
      const newError = result.errorReports[currentCount - 1];
      console.warn('🚨 NEW ERROR:', newError);
      lastCount = currentCount;
    }
  });
}, 2000); // Check every 2 seconds

// Stop with: clearInterval(intervalID)
```

---

## TL;DR

1. **F12** → **Application** → **Local Storage** → **chrome-extension://...**
2. Find **errorReports** key
3. Read the JSON array
4. Empty `[]` = no errors (good)
5. Errors in array = something broke (debug it)

That's it. You're now monitoring TokenWise in production.
