'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreviewServer } = require('./preview.cjs');
(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  const output = path.resolve(__dirname,'../test-results'); fs.mkdirSync(output,{recursive:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    if(process.env.CHECK_LIVE_AUDIO === '1') page.on('requestfailed', request => console.error(request.url(), request.failure()?.errorText));
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const origin=`http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    await page.locator('.home-path').waitFor();
    assert.equal(await page.locator('.mastery-card').count(),3);
    assert.equal(await page.locator('.home-path progress').getAttribute('value'),'0');
    await page.screenshot({path:path.join(output,'personalization-home.png'),fullPage:true});
    await page.locator('a[href="#personalization"]').click();
    assert.equal(await page.locator('.personalization-page .home-personalization-card').count(),3);
    await page.screenshot({path:path.join(output,'personalization-page.png'),fullPage:true});
    await page.locator('.brand').click();
    await page.getByRole('link',{name:'Continue My Path'}).click();
    await page.locator('.path-hero').waitFor();
    await page.locator('.brand').click(); await page.locator('.home-path').waitFor();
    await page.locator('a[href="#learning-method"]').click();
    await page.locator('[data-method="start"]').click();
    for(let i=0;i<8;i++) { await page.locator('input[name="method-answer"]').nth(i<6?2:0).check(); await page.locator('[data-method="next"]').click(); }
    assert.equal(await page.locator('#method-output').inputValue(),'100');
    assert.equal(await page.locator('#method-grammar').inputValue(),'100');
    await page.locator('[data-method="save"]').click(); await page.reload();
    assert.equal(await page.locator('#method-output').inputValue(),'100');
    await page.locator('.brand').click(); await page.locator('a[href="#interests"]').click();
    const options=page.locator('[data-interest-categories] [data-interest]');
    for(let i=0;i<11;i++) await options.nth(i).click();
    assert.equal(await page.locator('[data-interest-count]').innerText(),'10 / 10 selected');
    assert.match(await page.locator('[data-interest-save-status]').innerText(),/Remove one/);
    await page.reload(); assert.equal(await page.locator('[data-interest-count]').innerText(),'10 / 10 selected');
    await page.locator('[data-interest-selected] button').first().click();
    await page.locator('#interest-search').fill('space');
    await page.locator('[data-interest-categories] [data-interest="space"]').click();
    assert.equal(await page.locator('[data-interest-count]').innerText(),'10 / 10 selected');
    await page.locator('#interest-search').fill('zzzzzz');
    await page.getByRole('heading',{name:'No interests found'}).waitFor();
    await page.getByRole('button',{name:'Reset filters'}).click();
    await page.screenshot({path:path.join(output,'personalization-interests.png'),fullPage:true});
    await page.locator('.brand').click(); await page.locator('a[href="#regions"]').click();
    await page.locator('[data-country="ES"]').waitFor();
    assert.equal(await page.locator('[data-country]').count(),21);
    await page.locator('[data-country="ES"] .regions-hit').hover();
    assert.equal(await page.locator('.regions-tooltip').innerText(),'Spain');
    await page.locator('[data-country="ES"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-region-detail] h2').innerText(),'Spain');
    await page.locator('.regions-save').click(); await page.reload();
    await page.locator('[data-country="ES"]').waitFor();
    assert.equal(await page.locator('#region-country').inputValue(),'ES');
    assert.equal(await page.locator('[data-country="ES"]').getAttribute('aria-pressed'),'true');
    const countryIds=await page.locator('#region-country option').evaluateAll(nodes=>nodes.map(n=>n.value));
    for(const id of countryIds) {
      await page.locator('#region-country').selectOption(id);
      assert.match(await page.locator('[data-region-detail] audio').getAttribute('src'),/^https:\/\//);
      assert.equal(await page.locator(`[data-country="${id}"]`).getAttribute('aria-pressed'),'true');
    }
    await page.locator('[data-region-detail] audio').evaluate(a=>a.dispatchEvent(new Event('error')));
    assert.match(await page.locator('.regions-audio-status').innerText(),/could not load/);
    await page.locator('#region-country').selectOption('MX');
    if(process.env.CHECK_LIVE_AUDIO === '1') {
      for(const id of ['MX','GT','GQ']) {
        await page.locator('#region-country').selectOption(id);
        const result=await page.locator('audio').evaluate(audio=>new Promise(resolve=>{
          const timer=setTimeout(()=>resolve('timeout'),20000);
          audio.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve(audio.duration>0?'decoded':'invalid duration');},{once:true});
          audio.addEventListener('error',()=>{clearTimeout(timer);resolve(`media error ${audio.error?.code}`);},{once:true});
          audio.load();
        }));
        assert.equal(result,'decoded',`${id} live media decoding`);
      }
      await page.locator('#region-country').selectOption('MX');
    }
    await page.screenshot({path:path.join(output,'personalization-regions.png'),fullPage:true});
    await page.evaluate(async()=>{const data=await window.LearningData.load();await window.LearningData.completeActivity(data.grammarTopics[0].id);});
    await page.locator('.brand').click(); await page.reload();
    assert.equal(await page.locator('.home-path progress').getAttribute('value'),'1');
    for(const theme of ['light','dark']) for(const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      for(const route of ['home','personalization','learning-method','interests','regions']) {
        await page.goto(`${origin}/#${route}`);
        await page.locator(route==='home'?'.home-path':route==='personalization'?'.personalization-page':route==='regions'?'[data-country="MX"]':`#personalization-view`).waitFor();
        await page.evaluate(theme=>window.StudioTheme.apply(theme,false),theme);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${route} overflow at ${width}`);
        if(width===390) await page.screenshot({path:path.join(output,`personalization-${route}-${theme}-mobile.png`),fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);
    console.log('Personalization smoke passed: real home progress/navigation, quiz scoring/persistence, interest limit/search/persistence, all 21 map regions, keyboard selection, audio error fallback, light/dark and mobile layouts.');
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
