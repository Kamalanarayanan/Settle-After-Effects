# Settle 0.2.2

Settle is a product of CRIT Studio, ideated and created by Kamalanarayanan.
The panel footer opens an About card with studio and contact information.

Beginner-first 2D physics for Adobe After Effects CC 2019 through 2026.

Settle turns ordinary 2D layers into Dynamic, Passive, or Kinematic bodies,
previews their collisions inside the panel, and bakes the accepted result to
standard Position and Rotation keyframes.

It includes an offline copy of Matter.js 0.20.0. No network connection, licence
account, or external physics plugin is required at runtime.

## Five-minute workflow

1. Open a composition and select the layer that should move.
2. In **Bodies**, choose **Dynamic**, select a preset, and click Apply.
3. Select the floor, wall, or obstacle. Choose **Passive** and click Apply.
4. Open **Simulate** and click **Preview physics**.
5. If the preview looks right, click **Bake to keyframes**.
6. Optionally use **Clean** to reduce the baked keyframe count.

### Balloon hitting a box

1. Draw or select a box and apply **Passive**.
2. Draw or select a round layer and apply **Dynamic > Balloon**.
3. Place the balloon below the box.
4. Preview. Balloon uses negative per-body gravity, so it rises and reacts when
   it collides with the Passive box.
5. Adjust gravity scale, air resistance, and bounciness under
   **Advanced body settings** if needed.

## Body behaviors

- **Dynamic** — fully controlled by the solver; moves, rotates, and collides.
- **Passive** — fixed collider for floors, walls, and obstacles; never receives
  baked physics keys.
- **Kinematic** — follows existing After Effects Position and Rotation
  animation while pushing Dynamic bodies.

Passive and zero gravity are deliberately separate. A Passive object never
moves. A Dynamic object with gravity scale 0 can still move and react to
collisions. Negative gravity makes a Dynamic object float upward.

## Presets

- **Balloon** — very light, air-damped, bouncy, and negatively affected by
  gravity.
- **Rubber** — highly elastic with useful grip.
- **Plastic** — medium-light everyday-object behavior.
- **Metal** — high collision mass with little bounce.
- **Wood** — medium-light with stronger friction.
- **Ice** — almost frictionless.
- **Foam** — extremely light, soft, and air-damped.
- **Cardboard** — light with noticeable surface friction.

Presets are artist-friendly starting points, not laboratory material
measurements. Every value can be changed in Advanced.

### Natural motion and material feel

The visible **Natural motion** control adds preset-specific, smoothly changing
forces. Balloon receives air drift, lift variation, and rotational wobble.
Foam receives lighter drift; rigid materials receive progressively less.
Metal is intentionally almost deterministic and instead uses high collision
density, very low bounce and air drag, and a small cinematic gravity bias.

**New variation** changes the seed. The seed is saved per layer, making the
result repeatable: running Preview again or baking the same preview produces
the same motion rather than fresh random jitter.

## Advanced body controls

- Collision shape: box/layer bounds or circle
- Density (collision mass per area)
- Bounciness
- Friction
- Air resistance
- Per-body gravity scale, including 0 and negative values
- Seeded natural-motion amount
- Repeatable variation seed
- Initial X/Y velocity
- Initial angular velocity
- Fixed rotation

The Simulate tab also exposes global gravity, horizontal wind, substeps,
composition walls, work-area duration, and motion blur.

## Safety

- Previewing does not modify After Effects.
- Baking changes only configured Dynamic layers.
- A bake is wrapped in one After Effects undo group.
- Existing transform expressions and separated Position dimensions block a
  bake instead of being silently overwritten.
- The Clean tab reports measured simplification error.

## Current geometry limits

Settle 0.2.2 uses circles and rotated rectangles derived from visible layer
bounds. It does not yet simulate arbitrary mask/shape contours, concave bodies,
joints, liquids, magnets, or deformable bodies.

Only unparented 2D visual layers are currently supported. Parented layers, 3D
layers, cameras, and lights are rejected with a clear message. Scale is sampled
at the simulation start; Kinematic Position and Rotation are sampled across the
work area.

## Design basis

The beginner-facing terminology follows established 2D rigid-body workflows:
body type, density, friction, bounciness, damping, fixed rotation, initial
velocity, and per-body gravity. The implementation is independent and uses
Matter.js rather than Newton or Box2D code.

## Installation

Run the included installer script, completely quit After Effects, and reopen
it. Find Settle under **Window > Extensions** or **Window > Extensions
(Legacy)**, depending on the After Effects build.

macOS installs to:

    ~/Library/Application Support/Adobe/CEP/extensions/settle

Windows installs to:

    %APPDATA%\Adobe\CEP\extensions\settle

## Testing

From the release folder:

    npm test

The host suite covers scene inspection, body configuration, marker persistence,
safe baking, keyframe reduction, and serialisation. The physics suite covers
Dynamic/Passive collision, Balloon lift and collision, per-body zero gravity,
and Kinematic pushing.

## Third-party software

Matter.js 0.20.0 by Liam Brummitt and contributors is bundled under the MIT
licence. Its licence is included at client/js/matter.LICENSE.txt.

Settle is MIT-licensed. Crit Studio.
