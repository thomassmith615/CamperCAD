# CamperCAD

A browser-based 3D design tool for camper van conversions. Lay out cabinets,
beds, appliances, tanks and electrics inside an accurately modelled van, then
check the result against weight, axle loading, power, water and materials.

First supported vehicle: Ram ProMaster 2500, 159" wheelbase, high roof.

## Running it

Requires Node 18 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a production bundle.

## What it does

Model with boxes, cylinders, panels and shaped extrusions, with snapping,
live clearances, layers and undo. Place real components from a library. Then:

- Weight and balance against GVWR and both axle ratings
- Bill of materials, cut list and sheet nesting
- Electrical: consumption, battery and solar sizing, wire gauge
- Plumbing: water endurance, tank and pump sizing

Everything exports to CSV. Projects autosave locally and export as JSON.

## Notes

Controls adapt to mouse or trackpad automatically, and can be set manually in
the toolbar. All shortcuts are listed in the Controls panel in the sidebar.

Internal units are inches; metric display is fully supported.

The numbers are decision support, not certification. Weigh your own van and have
any electrical work checked by someone qualified.

## Built with

TypeScript, Vite and Three.js. No UI framework, no assets, no network calls.
