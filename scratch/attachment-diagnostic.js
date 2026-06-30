// TokenWise -- Attachment Diagnostic (paste into DevTools console on gemini.google.com)
// Run AFTER attaching files (image, pdf, video, audio, ppt, excel, docx) -- do NOT send yet.
(function attachmentDiag() {
  var ok   = function(m) { console.log('%c OK  '+m,'color:#4ade80;font-weight:bold'); };
  var fail = function(m) { console.error('%c FAIL '+m,'color:#f87171;font-weight:bold'); };
  var warn = function(m) { console.warn('%c WARN '+m,'color:#fb923c;font-weight:bold'); };
  var info = function(m) { console.log('%c INFO '+m,'color:#60a5fa'); };
  var sep  = function(t) { console.log('%c\n============================================================\n  '+t+'\n============================================================','color:#818cf8;font-weight:bold'); };

  // Shadow DOM traversal
  function findAll(sel, root, d) {
    root=root||document.body; d=d||0; var r=[];
    if(d>10)return r;
    try {
      if(root.shadowRoot){
        sel.split(',').forEach(function(s){ try{root.shadowRoot.querySelectorAll(s.trim()).forEach(function(e){r.push(e)});}catch(e){} });
        root.shadowRoot.querySelectorAll('*').forEach(function(c){ findAll(sel,c,d+1).forEach(function(e){r.push(e)}); });
      }
      root.querySelectorAll('*').forEach(function(c){ if(c.shadowRoot)findAll(sel,c,d+1).forEach(function(e){r.push(e)}); });
    }catch(e){}
    return r;
  }
  function qAll(sel){
    var light=[]; try{document.querySelectorAll(sel).forEach(function(e){light.push(e)});}catch(e){}
    var shadow=findAll(sel); var seen=new Set();
    return light.concat(shadow).filter(function(e){if(seen.has(e))return false;seen.add(e);return true;});
  }

  // STEP 1 -- Current TokenWise selector
  sep('STEP 1 -- TokenWise selector (dom-monitor.ts line ~64)');
  var TW='uploader-file-preview, gem-media-attachment, .file-preview-chip, .file-preview-container, .gem-attachment-tile';
  info('Selector in use: '+TW);
  var tw=qAll(TW);
  if(tw.length===0){fail('Selector finds ZERO elements -- PRIMARY BUG');}
  else{ok('Selector found '+tw.length+' element(s)');}

  // STEP 2 -- Broad search
  sep('STEP 2 -- Broad search: what is actually in the DOM?');
  var broad=['uploader-file-preview','gem-media-attachment','file-chip','upload-chip','file-preview','media-chip',
    '[class*=file-preview]','[class*=attachment]','[class*=upload-chip]','[class*=file-chip]',
    '[class*=media-chip]','[class*=img-chip]','[class*=image-chip]','[class*=gem-attach]',
    '[class*=file-tile]','[class*=file-upload]','[class*=media-upload]',
    '[aria-label*=attachment]','[aria-label*=Attachment]','[aria-label*=remove]','[aria-label*=Remove]',
    '[aria-label*=close]','[aria-label*=delete]',
    'rich-textarea img','.input-area img','[class*=thumbnail]','[class*=preview-chip]'];
  var allF=[],fpSel={};
  broad.forEach(function(sel){
    try{var f=qAll(sel);if(f.length>0){fpSel[sel]=f.length;f.forEach(function(e){allF.push(e);});}}catch(e){}
  });
  var seen3=new Set();
  var uniq=allF.filter(function(e){if(seen3.has(e))return false;seen3.add(e);return true;});
  if(uniq.length===0){
    fail('Broad search found ZERO elements -- files may not be attached, or Gemini changed its DOM');
  } else {
    ok('Broad search found '+uniq.length+' unique element(s)');
    Object.keys(fpSel).forEach(function(sel){info('  '+sel+' -> '+fpSel[sel]);});
  }

  // STEP 3 -- Raw attributes table
  sep('STEP 3 -- Raw element attributes (what TokenWise reads)');
  var vis=uniq.filter(function(e){return e.offsetWidth>0||e.offsetHeight>0||e.tagName.indexOf('-')!==-1;});
  info('Visible/custom elements: '+vis.length);
  var rep=[];
  vis.slice(0,12).forEach(function(e,i){
    var cls=(e.className||'').toString().trim().replace(/\s+/g,' ');
    var img=e.querySelector('img');
    rep.push({'#':i,tag:e.tagName.toLowerCase(),'class(50)':cls.slice(0,50),
      'aria-label':e.getAttribute('aria-label')||'(none)',
      title:e.getAttribute('title')||'(none)',
      'data-filename':e.getAttribute('data-filename')||'(none)',
      'data-filesize':e.getAttribute('data-filesize')||'(none)',
      'data-filetype':e.getAttribute('data-filetype')||'(none)',
      'text(60)':(e.textContent||'').trim().replace(/\n/g,' ').slice(0,60)||'(none)',
      'img-src(70)':img?(img.src||'').slice(0,70):'(none)',
      'img-alt':img?(img.getAttribute('alt')||'(none)'):'(none)',
      inShadow:!document.contains(e)});
  });
  if(rep.length>0)console.table(rep);

  // STEP 4 -- Pipeline simulation (WHY it shows "attachment")
  sep('STEP 4 -- Filename pipeline simulation (mirrors gemini.ts:detectAttachments)');
  info('Shows EXACTLY why files show as "attachment" in the optimization panel');
  var pipe=[];
  vis.slice(0,12).forEach(function(e,i){
    var img=e.querySelector('img');
    var fn=e.getAttribute('data-filename')||e.getAttribute('title')||e.getAttribute('aria-label')||(img&&img.getAttribute('alt'))||'';
    var src='(none)';
    if(e.getAttribute('data-filename'))src='data-filename';
    else if(e.getAttribute('title'))src='title';
    else if(e.getAttribute('aria-label'))src='aria-label';
    else if(img&&img.getAttribute('alt'))src='img[alt]';
    if(!fn&&img&&img.src){
      var s=img.src.toLowerCase();
      if(s.indexOf('blob:')===0||s.indexOf('image')!==-1){fn='image.jpg';src='img-src(blob/image)';}
      else if(s.indexOf('pdf')!==-1){fn='document.pdf';src='img-src(pdf)';}
      else{fn='attachment';src='img-src(fallback)';}
    }
    if(!fn){var t=(e.textContent||'').trim().slice(0,100);fn=t||'image.jpg';src=t?'textContent':'hardcoded-image.jpg';}
    var bad=fn==='attachment'||(fn==='image.jpg'&&src!=='data-filename'&&src!=='img[alt]')||(fn==='document.pdf'&&src!=='data-filename');
    pipe.push({'#':i,tag:e.tagName.toLowerCase(),detectedFileName:fn,source:src,IS_WRONG:bad?'YES -- shows as "attachment"':'ok'});
  });
  if(pipe.length>0){
    console.table(pipe);
    var bc=pipe.filter(function(r){return r.IS_WRONG!=='ok';}).length;
    if(bc>0){
      fail(bc+'/'+pipe.length+' elements produce a generic/wrong filename');
      warn('ROOT CAUSE: data-filename, title, aria-label, img[alt] are all empty or missing');
      warn('FIX: update fallback parser in gemini.ts:detectAttachments() to read the correct child node');
      info('Use Step 6 outerHTML to find which attribute/child holds the real filename');
    } else {ok('All filenames valid -- bug is in the selector (see Step 7)');}
  } else {warn('No elements to test -- selector issue (Steps 1 & 2)');}

  // STEP 5 -- Classname inventory
  sep('STEP 5 -- Class/tag inventory (all file-related patterns)');
  var kw=/attach|upload|preview|file-chip|media-chip|img-chip|gem-attach|thumbnail|file-tile|file-upload|media-upload|file-preview/i;
  var ch=new Map();
  qAll('*').forEach(function(e){
    var cls=(e.className||'').toString();var tag=e.tagName.toLowerCase();
    if(kw.test(cls)||kw.test(tag)){var k='<'+tag+' class="'+cls.trim().slice(0,80)+'">';if(!ch.has(k))ch.set(k,e);}
  });
  if(ch.size===0){fail('No file/attach/upload class names found anywhere in the DOM');}
  else{ok('Found '+ch.size+' attachment-related pattern(s):');Array.from(ch.keys()).slice(0,20).forEach(function(k){info('  '+k);});}

  // STEP 6 -- outerHTML dump
  sep('STEP 6 -- outerHTML of candidates (derive the correct selector from this)');
  var cands=vis.length>0?vis:Array.from(ch.values());
  if(cands.length===0){
    fail('No candidates -- attach files before running');
    var ctags=new Set(Array.from(document.querySelectorAll('*')).filter(function(e){return e.tagName.indexOf('-')!==-1;}).map(function(e){return e.tagName.toLowerCase();}));
    info('Custom tags on page: '+Array.from(ctags).sort().join(', '));
  } else {
    cands.slice(0,8).forEach(function(e,i){
      console.group('Candidate ['+i+'] <'+e.tagName.toLowerCase()+'>');
      info('outerHTML(600): '+e.outerHTML.slice(0,600));
      info('Attributes: '+Array.from(e.attributes).map(function(a){return a.name+'="'+a.value+'"';}).join(', ')||'(none)');
      info('Children('+e.children.length+'): '+Array.from(e.children).map(function(c){return c.tagName.toLowerCase();}).join(', ')||'(none)');
      console.groupEnd();
    });
  }

  // STEP 7 -- Selector recommendation
  sep('STEP 7 -- Selector fix recommendation');
  var mk=Object.keys(fpSel);
  if(mk.length>0){
    ok('Update dom-monitor.ts SITE_CONFIGS.gemini.fileAttachmentSelector to:');
    console.log('%c'+mk.slice(0,5).join(', '),'color:#a78bfa;font-weight:bold;font-size:13px');
    info('File: src/utils/dom-monitor.ts around line 64');
  } else {
    fail('No matching selectors -- derive one from Step 6 outerHTML');
    info('Find a unique class/tag and update dom-monitor.ts');
  }

  // STEP 8 -- Widget status
  sep('STEP 8 -- TokenWise widget & panel status');
  var w=document.getElementById('tokenwise-widget');
  var p=document.getElementById('tokenwise-suggestions');
  if(w){ok('Widget found (#tokenwise-widget) | display: '+(w.style.display||'not set'));}
  else{fail('Widget NOT found -- extension may not be active');}
  if(p){ok('Suggestion panel found | display: '+(p.style.display||'not set')+' | children: '+p.children.length);}
  else{warn('Suggestion panel not found (normal before any attachment/suggestions appear)');}

  // Summary
  sep('FINAL SUMMARY');
  if(tw.length===0&&uniq.length===0){
    fail('PRIMARY BUG: No attachment elements found by ANY selector');
    warn('Ensure files are attached. If they are, Gemini changed its DOM -- use Step 6 outerHTML');
  } else if(tw.length===0&&uniq.length>0){
    fail('PRIMARY BUG: Selector is WRONG -- elements exist but are not matched');
    ok('FIX: Update dom-monitor.ts fileAttachmentSelector with Step 7 recommendation');
  } else if(pipe.length>0&&pipe.some(function(r){return r.IS_WRONG!=='ok';})){
    warn('SECONDARY BUG: Selector matches but filename extraction gives "attachment"');
    warn('FIX: Update fallback parser in gemini.ts:detectAttachments()');
    info('See Step 4 & 6 -- find the attribute or child with the real filename');
  } else if(tw.length>0){
    ok('Pipeline looks healthy -- check Step 4 table for any wrong filenames');
  }
  console.log('\n%c DONE -- paste all output above for the exact fix ','background:#1a1a2e;color:#a78bfa;padding:4px 8px;border-radius:4px;font-weight:bold');
})();