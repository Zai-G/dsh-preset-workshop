      const catalogPackage = name => state.catalog.packages.find(pkg => pkg.name === name);
      const canonicalTool = name => state.catalog.tools.find(tool => tool.name === name);
      const canonicalSource = name => canonicalTool(name)?.package || '';
      function toolEnabled(tool, source = '') {
        const canonical = canonicalSource(tool.name), selected = draft.tools.sources?.[tool.name] || canonical;
        return draft.tools.enabled.includes(tool.name) && selected === (source || canonical);
      }
      function toolCard(tool, source = '') {
        const toolIcon = source || ['mcp', 'thirdparty'].includes(tool.kind) ? 'box' : toolIcons[tool.name] || 'box';
        const unavailable = tool.unavailable || !tool.available;
        const checked = toolEnabled(tool, source), sourceLabel = source ? `<small class="source-note">${esc(source.replace('@deepseek-ai/dsh-tool-', ''))}</small>` : '';
        const descriptionSource = source || tool.package || canonicalSource(tool.name);
        return `<div class="tool-card${checked ? '' : ' off'}">${icon(toolIcon)}<div class="tool-info"><div class="tool-name" title="${esc(tool.name)}">${esc(names[tool.name] || tool.name)}</div>${sourceLabel}${tool.schema ? `<button class="text-button" data-description="${esc(tool.name)}" data-description-source="${esc(descriptionSource)}">${t('工具描述', 'Description')} ${icon('chevron')}</button>` : ''}${unavailable ? `<span class="unavailable">${t('不可用', 'Unavailable')}</span>` : ''}</div><label class="switch"><input type="checkbox" data-tool="${esc(tool.name)}" ${source ? `data-tool-source="${esc(source)}"` : ''} aria-label="${esc(t('启用 ', 'Enable ') + tool.name + (source ? `（${source}）` : ''))}" ${checked ? 'checked' : ''} ${tool.serverDisabled || !tool.available && !tool.unavailable ? 'disabled' : ''}><span class="track"></span></label></div>`;
      }
      const toolSource = (name, source = '') => {
        const current = state.catalog.tools.find(tool => tool.name === name) || preview?.catalog.find(tool => tool.name === name);
        if (!source || current?.package === source) return current;
        return [current, ...(current?.alternates || [])].find(tool => tool?.package === source || tool?.source === source);
      };
      function fitToolLists() {
        for (const id of ['official-tools', 'thirdparty-tools', 'same-name-tools']) {
          const list = $(id), cards = [...list.querySelectorAll(':scope > .tool-card')];
          if (!list.offsetParent) continue;
          list.classList.toggle('is-capped', cards.length > 8);
          if (cards.length <= 8 || !cards[8].getBoundingClientRect().height) { list.style.maxHeight = 'none'; continue; }
          const gap = parseFloat(getComputedStyle(list).rowGap) || 8;
          const top = card => Math.round(card.getBoundingClientRect().top);
          const rowTops = [...new Set(cards.map(top))], ninthRow = rowTops.indexOf(top(cards[8]));
          const rowHeight = index => Math.max(...cards.filter(card => top(card) === rowTops[index]).map(card => card.getBoundingClientRect().height));
          let maxHeight = rowHeight(ninthRow) / 2;
          for (let index = 0; index < ninthRow; index += 1) maxHeight += rowHeight(index) + gap;
          list.style.maxHeight = `${maxHeight}px`;
        }
      }
      function tools() {
        const officialScroll = $('official-tools').scrollTop, thirdScroll = $('thirdparty-tools').scrollTop;
        const all = state.catalog.tools;
        const builtinNames = [all.some(tool => tool.name === 'pwsh' && tool.available) && !all.some(tool => tool.name === 'bash' && tool.available) ? 'pwsh' : 'bash', ...BUILTINS.slice(1)];
        const visible = all.filter(tool => tool.kind !== 'mcp'), official = visible.filter(tool => !builtinNames.includes(tool.name) && tool.kind !== 'thirdparty'), third = visible.filter(tool => !builtinNames.includes(tool.name) && tool.kind === 'thirdparty'), same = visible.flatMap(tool => (tool.alternates || []).slice(0, 2).map(provider => ({ provider, source: provider.source })));
        const cardSource = tool => tool.package && tool.package !== canonicalSource(tool.name) ? tool.package : '';
        const builtinMarkup = builtinNames.map(name => all.find(tool => tool.name === name)).filter(Boolean).map(tool => toolCard(tool, cardSource(tool))).join('');
        if ($('builtin-tools').innerHTML !== builtinMarkup) $('builtin-tools').innerHTML = builtinMarkup;
        const officialMarkup = official.map(tool => toolCard(tool, cardSource(tool))).join('');
        if ($('official-tools').innerHTML !== officialMarkup) $('official-tools').innerHTML = officialMarkup;
        $('thirdparty-tools').className = third.length ? 'tools-grid bounded-list' : 'bounded-list';
        const thirdMarkup = third.length ? third.map(tool => toolCard(tool, cardSource(tool))).join('') : `<div class="empty-state">${icon('box')}<span>${t('未发现第三方工具', 'No third-party tools detected')}</span></div>`;
        if ($('thirdparty-tools').innerHTML !== thirdMarkup) $('thirdparty-tools').innerHTML = thirdMarkup;
        $('same-name-group').hidden = same.length === 0;
        const sameMarkup = same.map(({ provider, source }) => toolCard(provider, source)).join('');
        if ($('same-name-tools').innerHTML !== sameMarkup) $('same-name-tools').innerHTML = sameMarkup;
        requestAnimationFrame(() => { $('official-tools').scrollTop = officialScroll; $('thirdparty-tools').scrollTop = thirdScroll; fitToolLists(); });
      }
      function syncToolPackages() {
        const packages = new Set();
        for (const [name, source] of Object.entries(draft.tools.sources || {})) if (draft.tools.enabled.includes(name)) packages.add(source);
        for (const name of draft.tools.enabled) {
          const source = draft.tools.sources?.[name] || canonicalSource(name), pkg = catalogPackage(source);
          if (pkg && !pkg.light) packages.add(pkg.name);
        }
        draft.tools.packages = [...packages];
      }
