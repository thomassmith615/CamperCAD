import * as THREE from 'three';
import {
  MIN_DIMENSION,
  type ObjectData,
  type ObjectKind,
  type ObjectProperties,
  type ObjectPropertyKey,
  type ObjectPropertyValue,
  type TransformSnapshot,
} from './ObjectTypes';

/**
 * Unit geometry shared by every box in the scene.
 *
 * It is translated so the box spans 0..1 in Y and −0.5..0.5 in X and Z, which
 * puts the object's origin at the **centre of its bottom face**. That choice
 * runs through the whole application: an object at `y = 0` sits on the floor,
 * the scale gizmo grows a cabinet upward instead of through the subfloor, and
 * "distance to floor" is just `position.y`.
 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/**
 * A user-placed object in the design.
 *
 * Dimensions are carried by the mesh's **scale** against shared unit geometry
 * rather than by rebuilt geometry. Resizing is then a matrix update instead of
 * a vertex buffer upload, hundreds of objects share one geometry, and the scale
 * gizmo edits width, height and depth directly with no translation layer.
 *
 * All state is exposed through {@link get} and {@link set} over a flat property
 * map, so the inspector and the undo system never need to know which underlying
 * field a property lives in.
 */
export class SceneObject {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

  private label: string;
  private weight = 0;
  private price = 0;
  private notes = '';
  private locked = false;

  /**
   * @param id Stable identifier, unique within the project.
   * @param kind Object kind, used by the factory and the future library.
   * @param name Display name.
   * @param color Initial colour as `#rrggbb`.
   */
  constructor(id: string, kind: ObjectKind, name: string, color: string) {
    this.id = id;
    this.kind = kind;
    this.label = name;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.62,
      metalness: 0.04,
    });

    this.mesh = new THREE.Mesh(UNIT_BOX, material);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.objectId = id;
  }

  /** Display name. Kept in sync with the mesh name for debugging. */
  get name(): string {
    return this.label;
  }

  /** True when the object is locked against transformation. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Reads a property.
   *
   * The generic signature is preserved for callers while the implementation
   * works over the value union, which is the only way to switch over a flat map
   * without one overload per key.
   */
  get<K extends ObjectPropertyKey>(key: K): ObjectProperties[K] {
    return this.read(key) as ObjectProperties[K];
  }

  /** Writes a property, clamping dimensions to a buildable minimum. */
  set<K extends ObjectPropertyKey>(key: K, value: ObjectProperties[K]): void {
    this.write(key, value as ObjectPropertyValue);
  }

  /** Captures position, rotation and dimensions for the undo system. */
  snapshot(): TransformSnapshot {
    const { position, rotation, scale } = this.mesh;
    return {
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z],
      dimensions: [scale.x, scale.y, scale.z],
    };
  }

  /** Restores a snapshot produced by {@link snapshot}. */
  restore(snapshot: TransformSnapshot): void {
    this.mesh.position.fromArray(snapshot.position);
    this.mesh.rotation.set(snapshot.rotation[0], snapshot.rotation[1], snapshot.rotation[2]);
    this.mesh.scale.set(
      Math.max(MIN_DIMENSION, snapshot.dimensions[0]),
      Math.max(MIN_DIMENSION, snapshot.dimensions[1]),
      Math.max(MIN_DIMENSION, snapshot.dimensions[2]),
    );
    this.mesh.updateMatrixWorld(true);
  }

  /**
   * Clamps scale to the minimum dimension.
   *
   * The scale gizmo can drive a value to zero or negative, which inverts
   * normals and makes the object unselectable. Called after every gizmo change
   * rather than trusting the control.
   */
  clampDimensions(): void {
    const { scale } = this.mesh;
    scale.set(
      Math.max(MIN_DIMENSION, Math.abs(scale.x)),
      Math.max(MIN_DIMENSION, Math.abs(scale.y)),
      Math.max(MIN_DIMENSION, Math.abs(scale.z)),
    );
  }

  /** World-space axis-aligned bounds, accounting for rotation. */
  boundingBox(): THREE.Box3 {
    this.mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this.mesh);
  }

  /** Serialisable representation. */
  toData(): ObjectData {
    const { position, rotation, scale } = this.mesh;
    return {
      schema: 1,
      id: this.id,
      kind: this.kind,
      name: this.label,
      dimensions: [scale.x, scale.y, scale.z],
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z],
      color: `#${this.mesh.material.color.getHexString()}`,
      weight: this.weight,
      price: this.price,
      notes: this.notes,
      locked: this.locked,
      visible: this.mesh.visible,
    };
  }

  /** Applies a serialised representation to this object, id excluded. */
  applyData(data: ObjectData): void {
    this.label = data.name;
    this.mesh.name = data.name;
    this.mesh.position.fromArray(data.position);
    this.mesh.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2]);
    this.mesh.scale.fromArray(data.dimensions);
    this.mesh.material.color.set(data.color);
    this.mesh.visible = data.visible;
    this.weight = data.weight;
    this.price = data.price;
    this.notes = data.notes;
    this.locked = data.locked;
    this.mesh.updateMatrixWorld(true);
  }

  /** Frees this object's material. Geometry is shared and never disposed. */
  dispose(): void {
    this.mesh.material.dispose();
  }

  /** Reads any property as its underlying value type. */
  private read(key: ObjectPropertyKey): ObjectPropertyValue {
    const { position, rotation, scale } = this.mesh;
    switch (key) {
      case 'name':
        return this.label;
      case 'color':
        return `#${this.mesh.material.color.getHexString()}`;
      case 'width':
        return scale.x;
      case 'height':
        return scale.y;
      case 'depth':
        return scale.z;
      case 'positionX':
        return position.x;
      case 'positionY':
        return position.y;
      case 'positionZ':
        return position.z;
      case 'rotationX':
        return rotation.x;
      case 'rotationY':
        return rotation.y;
      case 'rotationZ':
        return rotation.z;
      case 'weight':
        return this.weight;
      case 'price':
        return this.price;
      case 'notes':
        return this.notes;
      case 'locked':
        return this.locked;
      case 'visible':
        return this.mesh.visible;
    }
  }

  /** Writes any property from its underlying value type. */
  private write(key: ObjectPropertyKey, value: ObjectPropertyValue): void {
    const size = (input: ObjectPropertyValue) => Math.max(MIN_DIMENSION, Number(input));

    switch (key) {
      case 'name':
        this.label = String(value);
        this.mesh.name = this.label;
        break;
      case 'color':
        this.mesh.material.color.set(String(value));
        break;
      case 'width':
        this.mesh.scale.x = size(value);
        break;
      case 'height':
        this.mesh.scale.y = size(value);
        break;
      case 'depth':
        this.mesh.scale.z = size(value);
        break;
      case 'positionX':
        this.mesh.position.x = Number(value);
        break;
      case 'positionY':
        this.mesh.position.y = Number(value);
        break;
      case 'positionZ':
        this.mesh.position.z = Number(value);
        break;
      case 'rotationX':
        this.mesh.rotation.x = Number(value);
        break;
      case 'rotationY':
        this.mesh.rotation.y = Number(value);
        break;
      case 'rotationZ':
        this.mesh.rotation.z = Number(value);
        break;
      case 'weight':
        this.weight = Math.max(0, Number(value));
        break;
      case 'price':
        this.price = Math.max(0, Number(value));
        break;
      case 'notes':
        this.notes = String(value);
        break;
      case 'locked':
        this.locked = Boolean(value);
        break;
      case 'visible':
        this.mesh.visible = Boolean(value);
        break;
    }

    this.mesh.updateMatrixWorld(true);
  }
}
