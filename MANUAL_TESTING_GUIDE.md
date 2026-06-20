# TokenWise Manual Testing Guide

## Before You Do Anything

**Prerequisites:**
- Chrome browser with developer mode enabled
- TokenWise extension loaded as unpacked in `dist/` folder
- Open DevTools on each test site

---

## Quick Test (5 min — Do this first)

### Test 1: Widget Appears
**ChatGPT:**
1. Go to chat.openai.com
2. Look for TokenWise widget in bottom-right corner
3. **Expected:** "ChatGPT | Input: 0 | Total: 0" appears within 3 seconds
4. **If missing:** Check DevTools console for errors

**Claude:**
1. Go to claude.ai
2. Look for widget
3. **Expected:** Widget appears with Claude label

**Gemini:**
1. Go to gemini.google.com
2. Look for widget
3. **Expected:** Widget appears with Gemini label

**If any widget doesn't appear:**
- Open DevTools → Console tab
- Look for red error messages
- Report the error before continuing

---

## Full Test (1 hour — Production readiness)

### Setup (5 min)

**ChatGPT:**
```
1. Open chat.openai.com in new tab
2. Open DevTools (F12)
3. Go to Console tab
4. Make note of any errors (should be none)
5. Go to Application tab → Local Storage
   - Find "chrome-extension://..."
   - Note the extension ID (you'll need it later)
```

**Do same for claude.ai and gemini.google.com**

---

### Test 1: Token Counting Accuracy (15 min)

#### ChatGPT
```
1. In the input field, type: "Hello world testing TokenWise"
2. Look at widget: should show ~6 tokens
3. Type: "The quick brown fox jumps over the lazy dog"
4. Widget should update to ~9 tokens total
5. Copy-paste a long Wikipedia article
6. Widget should show 500+ tokens

PASS if: Widget updates correctly as you type
FAIL if: Widget shows 0, or doesn't update
```

#### Claude
```
Same test as ChatGPT
PASS if: Widget updates as you type
FAIL if: No update or shows 0
```

#### Gemini
```
Same test
PASS if: Updates correctly
FAIL if: Broken
```

---

### Test 2: Attachment Detection (20 min — CRITICAL)

#### ChatGPT
```
1. In ChatGPT, look for "+" or attachment button
2. Upload any file (PDF, text, image preferred)
3. Watch widget

PASS if: Widget shows "Attachments: 1" and increases total tokens
FAIL if: Widget shows no attachment tokens
FAIL if: Widget crashes or shows error

CRITICAL: If attachments don't show tokens, DO NOT SHIP
This is the #1 blocker
```

#### Claude
```
1. Look for attachment button (paper clip icon usually)
2. Upload a document
3. Check widget

PASS if: Shows attachment tokens
FAIL if: No attachment tokens shown
```

#### Gemini  
```
1. Look for image/file upload
2. Upload an image
3. Check widget

PASS if: Shows image tokens
FAIL if: Shows 0 tokens for image
```

---

### Test 3: Error Logging (10 min)

#### Check Error Storage
```
For each platform:
1. DevTools → Application → Local Storage
2. Find "chrome-extension://[your-extension-id]"
3. Look for key: "errorReports"
4. Value should be: [] (empty array, because no errors happened)

If you see errors: Read them, debug
If no "errorReports" key: Error logging not working
```

#### Force an Error (to verify logging works)
```
1. In DevTools Console, run:
   chrome.runtime.sendMessage({
     type: 'TEST_ERROR',
     data: { message: 'Test error' }
   })

2. Check Local Storage again
3. "errorReports" should now contain 1+ items

If it does: ✅ Error logging works
If not: ❌ Error logging is broken
```

---

### Test 4: Conversation Tracking (10 min)

#### ChatGPT
```
1. Type a message in the input field: "What is 2+2?"
2. Check widget shows input tokens
3. Send message (hit Enter)
4. Assistant responds
5. Check widget: "Total tokens" should increase

PASS if: Total tokens = (your tokens + assistant tokens)
FAIL if: Total doesn't increase after assistant response
FAIL if: Widget crashes
```

#### Claude
```
Same test
PASS if: Conversation tokens accumulate
```

#### Gemini
```
Same test
```

---

## Troubleshooting Checklist

**Widget doesn't appear:**
- [ ] Extension is loaded? Check chrome://extensions
- [ ] Is it enabled? (should have blue toggle)
- [ ] Check DevTools Console for errors
- [ ] Try opening DevTools → Sources → find extension code
- [ ] Reload page (Cmd+R or Ctrl+R)

**Tokens show as 0:**
- [ ] Is the input selector correct? (use DevTools Inspector)
- [ ] Does the input field have text in it?
- [ ] Check Console for selector errors

**Attachment tokens missing:**
- [ ] Can you see the attachment in the UI?
- [ ] Open DevTools Inspector
- [ ] Click on attachment element
- [ ] Note the actual HTML selector
- [ ] Check if it matches the code in `SITE_CONFIGS`
- [ ] This is likely THE problem — document the real selector

**Widget crashes when you upload file:**
- [ ] Check Console for error messages
- [ ] Is the attachment selector trying to parse something that's not a file?
- [ ] Look for "ATTACHMENT_DETECTION_FAILED" errors in error logs

**No error logs stored:**
- [ ] Extension is writing to chrome.storage? Check permissions
- [ ] Is chrome.storage.local available? Check manifest.json permissions
- [ ] Try manually triggering an error (see above)

---

## What To Do When Tests Fail

### Failure: Attachments not detected

**This is the #1 blocker. Do NOT ship if this fails.**

**Debug:**
```javascript
// In DevTools Console, on ChatGPT with attachment visible:

// Try these selectors:
document.querySelectorAll('[data-testid="attachment"]')  // Current (broken?)
document.querySelectorAll('.attachment')
document.querySelectorAll('[data-item-id]')
document.querySelectorAll('[data-testid*="file"]')
document.querySelectorAll('[role="listitem"]')

// One of these should return the actual attachment element
// When you find it, update SITE_CONFIGS in src/utils/dom-monitor.ts
```

**After finding the real selector:**
1. Edit `src/utils/dom-monitor.ts`
2. Update ChatGPT config: `chatgpt: { attachmentSelector: '[REAL_SELECTOR]', ... }`
3. Save file
4. Rebuild: `npm run build`
5. Reload extension in chrome://extensions
6. Test again

### Failure: Widget doesn't appear

**Debug:**
```javascript
// In DevTools Console:
chrome.runtime.getBackgroundPage().then(bg => {
  console.log('Background page:', bg);
});

// Check for extension errors
document.addEventListener('error', (e) => console.error('Error:', e));
```

If you see errors, the content script didn't load. Check manifest.json permissions and URLs.

### Failure: Error logging doesn't work

**This is infrastructure — should work automatically.**

Check:
```javascript
// In DevTools Console:
chrome.storage.local.get('errorReports', (result) => {
  console.log('Stored errors:', result);
});
```

If this is undefined or errors: chrome.storage permission not granted in manifest.json.

---

## Sign-Off Checklist (Print this)

**Before pushing to production, verify all ✅:**

```
CHATGPT:
☐ Widget appears within 3 seconds
☐ Token counting works (updates as you type)
☐ File attachment detection works (shows attachment tokens)
☐ Conversation tracking works (total tokens increase)
☐ No errors in DevTools console
☐ Error logs are stored (check Local Storage)

CLAUDE:
☐ Widget appears
☐ Token counting works
☐ File attachment detection works
☐ Conversation tracking works
☐ No errors

GEMINI:
☐ Widget appears
☐ Token counting works
☐ Image attachment detection works
☐ Conversation tracking works
☐ No errors

FINAL:
☐ All 3 platforms pass all tests
☐ Error logging verified working
☐ Attachment selectors are correct (not broken)
☐ Ran manual tests 2+ times, consistent results
☐ Ready to commit and push
```

**If ANY checkbox fails:** Fix before shipping.

---

## After You Ship

**Weekly Maintenance (5 min):**
```
Every Monday (or your chosen day):
1. Open DevTools on each platform
2. Check Application → Local Storage → errorReports
3. Read recent errors, if any
4. If error rate is high (10+), something broke
5. If selectors broke (no attachments detected), update them immediately
```

**When ChatGPT/Claude/Gemini Updates:**
- Manually test on the platform
- If widget doesn't appear or attachments don't work: update selectors
- Don't wait for users to report — proactively test
