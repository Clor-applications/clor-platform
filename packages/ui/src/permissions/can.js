/** A grant the signed-in user holds (admins hold all). The server checks again; this only hides what would be refused. */
export const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
