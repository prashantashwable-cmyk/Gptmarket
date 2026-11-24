import { core } from './en/core';
import { enums } from './en/enums';
import { app } from './en/app';
import { market } from './en/market';

export const en = {
  ...core, e: { ...enums, ...market.e, role: { ...enums.role, ...market.role } }, ...app,
  err: { ...core.err, ...market.err }, n: { ...app.n, ...market.n }, nav: { ...app.nav, ...market.nav }, mk: market.mk,
};
