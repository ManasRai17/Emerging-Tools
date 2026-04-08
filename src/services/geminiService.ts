export const parseHindiOrder = async (command: string) => {
  const res = await fetch('/api/parse-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command })
  });
  if (!res.ok) throw new Error("Failed to parse order");
  return await res.json();
};
