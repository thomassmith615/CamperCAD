import '@/styles/main.css';

import { Application } from '@/core/Application';
import { Toolbar } from '@/ui/Toolbar';
import { Sidebar } from '@/ui/Sidebar';
import { StatusBar } from '@/ui/StatusBar';
import { ViewControls } from '@/ui/ViewControls';
import { RAM_PROMASTER_2500_159_HIGH_ROOF } from '@/vehicle/catalog/ramProMaster2500_159_HighRoof';

/** Resolves a required mount point, failing loudly if the shell is malformed. */
function mount(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing mount point #${id}`);
  return element;
}

const app = new Application(mount('viewport'));

new Toolbar(mount('toolbar'), app);
new Sidebar(mount('sidebar'), app);
new StatusBar(mount('statusbar'), app);
new ViewControls(mount('view-controls'), app);

app.loadVehicle(RAM_PROMASTER_2500_159_HIGH_ROOF);

// Restore whatever was open last. Done after the UI is mounted so the panels
// receive the events the restore emits.
app.projects.restoreOrCreate();

app.start();

// Vite replaces the whole module on edit; without this the previous instance
// keeps its render loop and event listeners alive alongside the new one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
