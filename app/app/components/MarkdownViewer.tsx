"use client";

import React from "react";

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function isSeparatorRow(line: string): boolean {
  return (
    line.trim().startsWith("|") &&
    line
      .split("|")
      .slice(1, -1)
      .every((cell) => /^[\s\-:]+$/.test(cell))
  );
}

export default function MarkdownViewer({ content }: { content: string }) {
  const lines = content.split("\n");
  const rendered: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Code block ---
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      rendered.push(
        <pre
          key={rendered.length}
          className="p-4 bg-[#0D0D0D] border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] font-mono overflow-x-auto my-3 whitespace-pre-wrap rounded"
        >
          {codeLines.join("\n")}
        </pre>
      );
      continue;
    }

    // --- Table block ---
    if (
      line.trim().startsWith("|") &&
      line.trim().endsWith("|") &&
      !isSeparatorRow(line)
    ) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableLines.push(lines[i]);
        i++;
      }
      const dataRows = tableLines
        .filter((l) => !isSeparatorRow(l))
        .map((l) =>
          l
            .split("|")
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
            .map((c) => c.trim())
        );
      if (dataRows.length > 0) {
        rendered.push(
          <div key={rendered.length} className="overflow-x-auto my-3">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  {dataRows[0].map((h, j) => (
                    <th
                      key={j}
                      className="px-3 py-2 text-left text-[var(--gold-primary)] font-medium border border-[var(--border-default)] bg-[var(--bg-surface)]"
                    >
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 text-[var(--text-secondary)] border border-[var(--border-default)]"
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }
    // Skip standalone separator rows
    if (isSeparatorRow(line)) {
      i++;
      continue;
    }

    // --- Headings ---
    if (line.startsWith("#### ")) {
      rendered.push(
        <h4
          key={rendered.length}
          className="text-[14px] font-semibold text-[var(--text-primary)] mt-3 mb-1"
        >
          {renderInline(line.slice(5))}
        </h4>
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      rendered.push(
        <h3
          key={rendered.length}
          className="text-[16px] font-semibold text-[var(--text-primary)] mt-4 mb-1"
        >
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      rendered.push(
        <h2
          key={rendered.length}
          className="font-serif text-[22px] font-semibold text-[var(--text-primary)] mt-5 mb-2"
        >
          {renderInline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      rendered.push(
        <h1
          key={rendered.length}
          className="font-serif text-[28px] font-bold text-[var(--text-primary)] mt-6 mb-3"
        >
          {renderInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // --- Horizontal rule ---
    if (line.trim() === "---") {
      rendered.push(
        <hr
          key={rendered.length}
          className="border-[var(--border-default)] my-4"
        />
      );
      i++;
      continue;
    }

    // --- Blockquote ---
    if (line.startsWith("> ")) {
      rendered.push(
        <div
          key={rendered.length}
          className="pl-4 border-l-2 border-[var(--gold-primary)] my-2 text-[13px] text-[var(--text-tertiary)] italic"
        >
          {renderInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // --- List item ---
    if (line.trim().startsWith("- ")) {
      rendered.push(
        <div key={rendered.length} className="flex gap-2 ml-4 my-0.5">
          <span className="text-[var(--gold-primary)] shrink-0">•</span>
          <span className="text-[13px] text-[var(--text-secondary)]">
            {renderInline(line.trim().slice(2))}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // --- Numbered list ---
    if (/^\d+\.\s/.test(line.trim())) {
      const match = line.trim().match(/^(\d+)\.\s(.*)/);
      if (match) {
        rendered.push(
          <div key={rendered.length} className="flex gap-2 ml-4 my-0.5">
            <span className="text-[var(--gold-primary)] shrink-0 text-[13px] font-medium">
              {match[1]}.
            </span>
            <span className="text-[13px] text-[var(--text-secondary)]">
              {renderInline(match[2])}
            </span>
          </div>
        );
      }
      i++;
      continue;
    }

    // --- Empty line ---
    if (line.trim() === "") {
      rendered.push(<div key={rendered.length} className="h-1" />);
      i++;
      continue;
    }

    // --- Normal paragraph ---
    rendered.push(
      <p
        key={rendered.length}
        className="text-[13px] text-[var(--text-secondary)] leading-relaxed"
      >
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="flex flex-col">{rendered}</div>;
}
