export const getNextNumericId = (list) => {
  const rows = Array.isArray(list) ? list : [];
  const maxId = rows.reduce((max, row) => {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) return max;
    return id > max ? id : max;
  }, 0);
  return maxId + 1;
};
