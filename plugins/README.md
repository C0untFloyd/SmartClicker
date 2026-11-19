# Plugins

Optional feature modules loaded on demand by the renderer. A script opts in with a top-level
list; without it the plugin's action types are unknown:

```yaml
scriptName: "Sushi Station"
plugins: [sushi]
actions:
  - actionType: sushistation
    ...
```

## Layout

```
plugins/
  <id>/
    index.js   plugin entry (registers its action descriptors + executor)
    ...        any private helpers/assets (ESM modules)
```

Plugin ids must match `[a-zA-Z0-9_-]+`. The loader imports `./plugins/<id>/index.js` relative to
`renderer.js`, so it works in development and in a packaged build (the `plugins` folder is part of
`build.files`).

## Registration

Import `registerPlugin` from `../../models.js` and register one or more actions:

```js
import { ActionBase, registerPlugin } from '../../models.js';

class MyAction extends ActionBase {
    constructor(data = {}) {
        super('myaction', data);
        this.value = data.value ?? 10;
    }

    toDict() {
        return { ...super.toDict(), value: this.value };
    }
}

export default registerPlugin({
    id: 'myplugin',
    name: 'My Plugin',
    actions: [{
        actionType: 'myaction',
        label: 'My Action',
        description: 'What it does',
        group: 'Games',
        icon: '🎮',
        create: (data) => new MyAction(data),
        createDefault: () => new MyAction({}),
        describe: (action) => `My Action: ${action.value}`,
        renderFields: (form, action, ui) => {
            ui.addFormField(form, 'Value', action.value, 'number', false, (v) => {
                action.value = ui.toInt(v, 10);
            });
        },
        execute: async (action, host) => {
            host.status('Running my action...');
            await host.sleep(250);
            if (host.stopRequested()) return;
            await host.electronAPI.mouseClick('left', 100, 100, 50);
        }
    }]
});
```

## Action descriptor

| Field | Required | Purpose |
|---|---|---|
| `actionType` | yes | YAML `actionType` string. Must be unique. |
| `create(data)` | yes | Build the action instance from parsed YAML. |
| `createDefault()` | yes | Build a palette default. |
| `label` / `description` / `group` / `icon` | no | Palette entry and tree icon. |
| `describe(action)` | no | Tree label; defaults to the raw action type. |
| `renderFields(form, action, ui)` | no | Detail-panel editor. |
| `execute(action, host)` | no | Run the action. |

`renderFields` helpers: `addFormField(form, label, value, type, readonly, onChange, options)`,
`addFormSection(form, title)`, `toInt`, `toFloat`, `renderTree()`.

`execute` receives a host created by the renderer:

| Host field | Meaning |
|---|---|
| `electronAPI` | The preload bridge (`window.electronAPI`). |
| `cv` | OpenCV.js global, or `null` if it is still loading. |
| `status(text)` | Update the status bar. |
| `log(...args)` / `warn(...args)` | Console helpers. |
| `sleep(ms)` | Promise-based delay. |
| `stopRequested()` | True after `Shift+Esc`/Stop. |
| `findImageOnScreen(paths, confidence, mode, threshold)` | Core template matcher. |

Long-running plugin loops should check `host.stopRequested()` and let errors propagate; the
renderer catches them, restores the window and shows the error.

## Loading

`renderer.js > ensurePlugins(ids)` runs before `new AutomationScript(data)` on every script load
(including `--script=`). It imports the module, then verifies the plugin registered itself. The
palette and detail panel read the registry lazily, so plugin actions appear as soon as the script
that needs them is loaded. Saving the script writes the `plugins` list back.
