// ==UserScript==
// @name         Survev Custom Sounds
// @namespace    zahirr
// @version      0.03
// @description  Custom gun, reload and hit sounds for survev.io
// @author       zahirr
// @match        https://survev.io/*
// @match        https://*.survev.io/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

// sounds come from the Surviv Custom Sounds & Textures pack (HumphreyGaming / HVP)

(function () {
    'use strict';

    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const RAW_BASE = 'https://raw.githubusercontent.com/humphreygaming/survivcustomsoundsandtextures/master/audio/';
    const CONCURRENCY = 8;
    const TRIES = 3;
    const DB_NAME = 'survev-custom-sounds-cache';

    // every sound in the pack, grouped by folder
    const PACK = {
    guns: `
        ak47_01 ak47_reload_01 ak47_switch_01 awc_01 awc_cycle_01 awc_pull_01 awc_reload_01
        bar_01 bar_reload_01 bar_switch_01 blr_01 blr_cycle_01 blr_reload_01 deagle_01
        deagle_reload_01 deagle_reload_02 deagle_switch_01 dp28_01 dp28_reload_01
        dp28_switch_01 famas_01 famas_reload_01 famas_switch_01 garand_01 garand_02
        garand_reload_01 glock_01 glock_reload_01 glock_reload_02 glock_switch_01
        groza_reload_01 grozas_01 hk416_01 hk416_reload_01 hk416_switch_01 l86_01
        l86_reload_01 m1014_01 m1a1_01 m1a1_reload_01 m249_01 m249_reload_01 m39_01
        m39_reload_01 m39_switch_01 m870_01 m870_cycle_01 m870_pull_01 m870_reload_01
        m93r_01 m93r_reload_01 m93r_reload_02 m93r_switch_01 m9_01 m9_reload_01 m9_switch_01
        mac10_01 mac10_reload_01 mac10_switch_01 mk12_01 mk12_reload_01 mk12_switch_01
        mosin_01 mosin_cycle_01 mosin_pull_01 mosin_reload_01 mosin_reload_02 mp220_01
        mp220_deploy_01 mp220_reload_01 mp5_01 mp5_reload_01 mp5_switch_01 ot38_01
        ot38_reload_01 ot38_reload_02 ot38_switch_01 pkp_01 pkp_reload_01 pkp_switch_01
        qbb97_01 qbb97_reload_01 qbb97_switch_01 saiga_01 saiga_reload_01 saiga_switch_01
        scar_01 scar_reload_01 scar_switch_01 scarssr_01 scout_01 scout_reload_01 spas12_01
        spas12_cycle_01 spas12_pull_01 spas12_reload_01 sv98_01 sv98_cycle_01 sv98_pull_01
        sv98_reload_01 svd_01 svd_reload_01 ump9_01 ump9_reload_01 ump9_switch_01 vector_01
        vector_reload_01 vector_switch_01 vss_01 vss_reload_01
    `,
    hits: `
        axe_hit_01 player_bullet_hit_01 player_bullet_hit_02
    `,
    sfx: `
        log_04
    `,
    };

    const PATHS = [];
    for (const dir in PACK) {
        for (const name of PACK[dir].trim().split(/\s+/)) PATHS.push(dir + '/' + name);
    }
    const PATHSET = new Set(PATHS);

    const cache = new Map();
    const failed = new Map();
    const stats = { total: PATHS.length, done: 0, failed: 0, cached: 0 };

    const dbReady = new Promise(resolve => {
        try {
            const req = page.indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('s');
            req.onsuccess = () => resolve(req.result);
            req.onerror = req.onblocked = () => resolve(null);
        } catch (_) { resolve(null); }
    });

    const idb = (mode, fn) => dbReady.then(db => new Promise(resolve => {
        if (!db) return resolve(null);
        try {
            const req = fn(db.transaction('s', mode).objectStore('s'));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
    }));

    const wait = ms => new Promise(r => setTimeout(r, ms));

    function download(path) {
        const url = RAW_BASE + path + '.mp3';
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'arraybuffer', timeout: 20000,
                onload: r => (r.status >= 200 && r.status < 300 && r.response && r.response.byteLength)
                    ? resolve(r.response) : reject(new Error('HTTP ' + r.status)),
                onerror: () => reject(new Error('network')),
                ontimeout: () => reject(new Error('timeout'))
            }));
        }
        return page.fetch(url).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status)));
    }

    // if a download fails try it again a couple times before giving up
    async function downloadWithRetry(path) {
        let err;
        for (let i = 0; i < TRIES; i++) {
            try { return await download(path); } catch (e) { err = e; }
            if (i < TRIES - 1) await wait(600 * (i + 1));
        }
        throw err;
    }

    function getSound(path) {
        if (cache.has(path)) return cache.get(path);
        const p = idb('readonly', s => s.get(path)).then(async saved => {
            if (saved && saved.byteLength) { stats.cached++; return saved; }
            const buf = await downloadWithRetry(path);
            idb('readwrite', s => s.put(buf, path));
            return buf;
        }).catch(err => {
            failed.set(path, (failed.get(path) || 0) + 1);
            cache.delete(path);
            throw err;
        });
        cache.set(path, p);
        return p;
    }

    // a sound that failed in the preload gets one more round when the game asks for it, after that its the original
    const usable = path => PATHSET.has(path) && (failed.get(path) || 0) < 2;

    let ui = null;

    function mountLoader() {
        if (ui || !document.documentElement) return;

        const style = document.createElement('style');
        style.textContent = `
        #scs-loader{position:fixed;right:18px;top:18px;z-index:2147483647;width:290px;max-width:calc(100vw - 28px);
            box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:8px;color:#fff;
            font-family:"Roboto Condensed",Arial,sans-serif;background:rgba(0,0,0,.4);border-radius:5px;
            pointer-events:none;opacity:0;transform:translateY(-8px);transition:opacity .25s ease,transform .25s ease}
        #scs-loader.scs-show{opacity:1;transform:translateY(0)}
        #scs-loader .scs-icon{flex:0 0 48px;width:48px;height:48px}
        #scs-loader .scs-icon img{display:block;width:48px;height:48px}
        #scs-loader .scs-body{flex:1;min-width:0}
        #scs-loader .scs-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
        #scs-loader .scs-status{font-size:14px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}
        #scs-loader .scs-count{font-size:13px;font-weight:700;white-space:nowrap}
        #scs-loader .scs-bar{position:relative;height:14px;margin-top:6px;background:rgba(0,0,0,.4);
            border-radius:5px;overflow:hidden}
        #scs-loader .scs-bar div{position:absolute;top:0;left:0;height:100%;width:0;border-radius:5px}
        #scs-loader .scs-fill{background:#83af50;transition:width .15s ease-out}
        #scs-loader .scs-note{margin-top:4px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;opacity:.8}
        @media (max-width:600px){#scs-loader{right:10px;top:10px;width:260px}}`;

        const el = document.createElement('div');
        el.id = 'scs-loader';
        el.innerHTML = `
            <div class="scs-icon"><img src="/img/gui/gas.svg" alt=""></div>
            <div class="scs-body">
                <div class="scs-head"><span class="scs-status"></span><span class="scs-count"></span></div>
                <div class="scs-bar"><div class="scs-fill"></div></div>
                <div class="scs-note"></div>
            </div>`;

        document.documentElement.append(style, el);

        const icon = el.querySelector('.scs-icon img');
        icon.onerror = () => { icon.style.display = 'none'; };

        ui = {
            el,
            status: el.querySelector('.scs-status'),
            fill: el.querySelector('.scs-fill'),
            count: el.querySelector('.scs-count'),
            note: el.querySelector('.scs-note')
        };
        render();
        requestAnimationFrame(() => el.classList.add('scs-show'));
    }

    function hideLoader() {
        if (!ui) return;
        const { el } = ui;
        ui = null;
        el.classList.remove('scs-show');
        setTimeout(() => el.remove(), 400);
    }

    function render() {
        if (!ui) return;
        const pct = n => Math.min(100, Math.round(n / stats.total * 100)) + '%';
        ui.fill.style.width = pct(stats.done);
        ui.count.textContent = stats.done + ' / ' + stats.total;

        if (stats.done < stats.total) {
            ui.status.textContent = 'Loading sounds';
            ui.note.textContent = stats.cached ? stats.cached + ' cached' : 'Custom pack';
            return;
        }

        ui.status.textContent = stats.failed ? 'Some sounds missing' : 'Sounds ready';
        ui.note.textContent = stats.failed ? stats.failed + ' using default' : 'All set';
        setTimeout(hideLoader, stats.failed ? 3000 : 1200);
    }

    async function preload() {
        // only show the loading screen if theres something to download
        const keys = await idb('readonly', s => s.getAllKeys());
        const have = new Set(keys || []);
        if (PATHS.some(p => !have.has(p))) {
            mountLoader();
            if (!ui) document.addEventListener('DOMContentLoaded', mountLoader, { once: true });
        }

        let next = 0;
        const worker = async () => {
            while (next < PATHS.length) {
                try { await getSound(PATHS[next++]); } catch (_) { stats.failed++; }
                stats.done++;
                render();
            }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        render();
        console.info('[survev custom sounds]', stats.total - stats.failed, 'ready,', stats.failed, 'failed,', stats.cached, 'cached');
    }

    // survev asks for sounds like "audio/guns/ak47_01.mp3"
    const SOUND_URL = /audio\/((?:guns|hits|sfx)\/\w+)\.mp3/;
    const originalFetch = page.fetch;

    page.fetch = function (input) {
        try {
            const url = typeof input === 'string' ? input : (input && (input.url || input.href));
            const match = url && SOUND_URL.exec(url);
            if (match && usable(match[1])) {
                const args = arguments;
                return getSound(match[1]).then(
                    // slice() so every request gets its own copy, decodeAudioData detaches the buffer
                    buf => new Response(buf.slice(0), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }),
                    () => originalFetch.apply(page, args)
                );
            }
        } catch (err) {
            console.warn('[survev custom sounds] using original sound', err);
        }
        return originalFetch.apply(this, arguments);
    };

    preload();
})();