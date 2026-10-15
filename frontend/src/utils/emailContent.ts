// Quoted history stays attached to its original email; it is not a newly sent message.
export function separateEmailContent(value: string): { body: string; quoted: string[] } {
  const parts: string[] = [];
  let current: string[] = [];
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const nextLines = lines.slice(index + 1, index + 8);
    const headers = nextLines.filter(next => /^\s*(From|Sent|To|Subject|Date):\s+\S/i.test(next)).length;
    const boundary = /^\s*On .{8,}wrote:\s*$/i.test(line)
      || (/^\s*[-_=]{6,}\s*$/.test(line) && headers >= 2)
      || (/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i.test(line) && headers >= 2)
      || (/^\s*From:\s+\S/i.test(line) && headers >= 2 && !/^\s*[-_=]{2,}/.test(lines[index - 1] || ""))
      || (/^\s*>/.test(line) && /^\s*>/.test(lines[index + 1] || "") && !/^\s*>|^\s*On .{8,}wrote:\s*$/i.test(lines[index - 1] || ""));
    if (boundary && current.some(part => part.trim())) {
      parts.push(current.join("\n").trim()); current = [];
    }
    current.push(line);
  });
  if (current.some(line => line.trim())) parts.push(current.join("\n").trim());
  return { body: parts[0] || "", quoted: parts.slice(1) };
}
