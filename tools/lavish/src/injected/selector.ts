export interface AnchorElement {
  tagName: string;
  id: string;
  parentElement: AnchorElement | null;
  children: Iterable<AnchorElement>;
  getAttribute(name: string): string | null;
  innerText?: string;
  textContent?: string | null;
}

export interface DomAnchor {
  tag: string;
  id: string | null;
  role: string | null;
  name: string | null;
  text: string;
  selector: string;
  url: string;
}

export function createBoundedAnchor(element: AnchorElement, url: string): DomAnchor {
  const parts: string[] = [];
  let current: AnchorElement | null = element;
  while (current && current.parentElement && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      const escaped = current.id.replace(/[^A-Za-z0-9_-]/g, (character) => {
        const codepoint = character.codePointAt(0);
        return `\\${codepoint?.toString(16) ?? ""} `;
      });
      part += `#${escaped}`;
    } else {
      let matchingSiblings = 0;
      let position = 0;
      for (const sibling of current.parentElement.children) {
        if (sibling.tagName !== current.tagName) continue;
        matchingSiblings += 1;
        if (sibling === current) position = matchingSiblings;
      }
      if (matchingSiblings > 1) part += `:nth-of-type(${position})`;
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    role: element.getAttribute("role"),
    name: element.getAttribute("aria-label") || element.getAttribute("name"),
    text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 240),
    selector: parts.join(" > "),
    url,
  };
}

export const SELECTOR_RUNTIME = `const createBoundedAnchor = ${createBoundedAnchor.toString()};`;
