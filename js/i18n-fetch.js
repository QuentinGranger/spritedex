/* Attach the selected locale to every existing API request. */
window.SpriteIndexI18nFetch = Object.freeze({
  install(locale) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has("Accept-Language")) headers.set("Accept-Language", locale);
      return nativeFetch(input, { ...init, headers });
    };
  }
});
