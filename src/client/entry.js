    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: { nav: '预设工坊' }, en: { nav: 'Preset Workshop' } }));
      const title = ctx.locale.bind(NS);
      function WorkshopCard() {
        const ref = React.useRef();
        React.useEffect(() => {
          const root = ref.current.shadowRoot || ref.current.attachShadow({ mode: 'open' }), controller = new AbortController();
          let dispose;
          mount(root, ctx, controller.signal).then(cleanup => { if (controller.signal.aborted) cleanup(); else dispose = cleanup; }).catch(error => { if (!controller.signal.aborted) { root.textContent = error.message; const button = document.createElement('button'); button.textContent = 'Retry / 重试'; button.onclick = () => location.reload(); root.append(button); } });
          return () => { controller.abort(); dispose?.(); };
        }, []);
        return React.createElement('div', { ref, style: { minWidth: 0, width: '100%' } });
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-preset-workshop', order: 50, label: () => title('nav'), locale: NS }, WorkshopCard));
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'dsh-preset-workshop', order: 50 }, ({ size }) => React.createElement('span', { 'aria-hidden': true, style: { display: 'block', width: size, height: size, flex: 'none', backgroundColor: 'currentColor', maskImage: 'url("/preset-workshop/icon.png")', WebkitMaskImage: 'url("/preset-workshop/icon.png")', maskSize: 'contain', WebkitMaskSize: 'contain', maskPosition: 'center', WebkitMaskPosition: 'center', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' } })));
    }
    return { inject: ['slots', 'locale'], apply };
  },
});
