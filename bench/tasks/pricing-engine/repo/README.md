# pricing-engine

Internal invoicing math library for billing services. Money amounts are USD
dollars (floats) at the API boundary; all tax and discount math funnels
through `roundCents`.

Run tests: `bun test`

The `tests/` directory is the executable spec for billing behavior — when
source and tests disagree, the tests win.
