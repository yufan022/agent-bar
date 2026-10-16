export function rewriteMapValues(
  map: Record<string, string>,
  rewrite: (value: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(map).sort(compareText)) {
    out[key] = rewrite(map[key] ?? "");
  }
  return out;
}

export function rewriteEnvCursorToClaude(input: string): string {
  return rewritePlaceholders(input, (inner) => {
    if (inner.startsWith("env:")) {
      return `\${${inner.slice("env:".length)}}`;
    }
    return `\${${inner}}`;
  });
}

export function rewriteEnvClaudeToCursor(input: string): string {
  return rewritePlaceholders(input, (inner) => {
    if (inner.startsWith("env:")) {
      return `\${${inner}}`;
    }
    return `\${env:${inner}}`;
  });
}

export function rewriteEnvOpencodeToClaude(input: string): string {
  let out = "";
  let index = 0;
  while (index < input.length) {
    if (input.startsWith("{env:", index)) {
      const end = input.indexOf("}", index + "{env:".length);
      if (end !== -1) {
        const name = input.slice(index + "{env:".length, end);
        out += `\${${name}}`;
        index = end + 1;
        continue;
      }
    }
    out += input[index];
    index += 1;
  }
  return rewriteEnvCursorToClaude(out);
}

export function rewriteEnvClaudeToOpencode(input: string): string {
  return rewritePlaceholders(input, (inner) => {
    const withoutPrefix = inner.startsWith("env:") ? inner.slice("env:".length) : inner;
    const name = withoutPrefix.split(":-")[0] ?? withoutPrefix;
    return `{env:${name}}`;
  });
}

function rewritePlaceholders(input: string, replace: (inner: string) => string): string {
  let out = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] === "$" && input[index + 1] === "{") {
      const end = input.indexOf("}", index + 2);
      if (end !== -1) {
        out += replace(input.slice(index + 2, end));
        index = end + 1;
        continue;
      }
    }
    out += input[index];
    index += 1;
  }
  return out;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
