// Fragment checks use the sampled DOM only: no navigation or network requests.
export function missingFragments(links, pageUrl, targets) {
  const page = new URL(pageUrl);
  page.hash = '';
  const known = new Set(targets);
  const missing = new Set();
  for (const value of links) {
    let link;
    try { link = new URL(value, pageUrl); } catch { continue; }
    const hash = link.hash.slice(1);
    link.hash = '';
    // Text fragments need browser text matching, not ID lookup.
    if (link.href !== page.href || !hash || hash.includes(':~:text=')) continue;
    let fragment;
    try { fragment = decodeURIComponent(hash); } catch { continue; }
    // HTML treats #top (ASCII case-insensitive) as the document top.
    if (!known.has(fragment) && fragment.toLowerCase() !== 'top') missing.add(fragment);
  }
  return [...missing];
}
