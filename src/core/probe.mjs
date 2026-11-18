/** 页面结构探测：给使用者一个起点，用来填 adapter/config.json 的选择器 */
export async function probePage(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const counts = {
      radio: document.querySelectorAll('input[type=radio]').length,
      checkbox: document.querySelectorAll('input[type=checkbox]').length,
      textInput: document.querySelectorAll('input[type=text]').length,
      button: document.querySelectorAll('button, [class*=btn]').length,
      iframe: document.querySelectorAll('iframe').length,
      canvas: document.querySelectorAll('canvas').length,
    };
    const blocks = [...document.querySelectorAll('div,section,li,article')]
      .filter((n) => {
        const t = clean(n.innerText);
        return t.length > 30 && t.length < 1500;
      })
      .slice(0, 25)
      .map((n) => ({
        tag: n.tagName.toLowerCase(),
        id: n.id,
        cls: typeof n.className === 'string' ? n.className.slice(0, 60) : '',
        text: clean(n.innerText).slice(0, 100),
      }));
    return { url: location.href, title: document.title, counts, blocks };
  });
}
