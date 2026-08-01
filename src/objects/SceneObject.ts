import * as THREE from 'three';
import { GeometryRegistry, KIND_INFO } from '@/geometry/GeometryRegistry';
import { isProfileUsable, profileBounds, type ProfilePoint } from '@/geometry/ProfileShapes';
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
 * The geometry source shared by every object.
 *
 * Module-level rather than injected because geometry identity must be global:
 * two objects of the same kind have to share one buffer, and an object created
 * by the factory, by a project load and by an undo must all get the same one.
 */
const GEOMETRY = new GeometryRegistry();

/** Exposes the registry so the UI can build matching ghosts and outlines. */
export function geometryRegistry(): GeometryRegistry {
  return GEOMETRY;
}

/**
 * A user-placed object in the design.
 *
 * Dimensions are carried by the mesh's **scale** against normalised unit
 * geometry rather than by rebuilt geometry. Resizing is then a matrix update
 * instead of a vertex buffer upload, objects of a kind share one geometry, and
 * the scale gizmo edits width, height and depth directly with no translation
 * layer. {@link GeometryRegistry} guarantees every kind honours that contract,
 * so a cylinder and a box respond to the same scale identically.
 *
 * All state is exposed through {@link get} and {@link set} over a flat property
 * map, so the inspector and the undo system never need to know which underlying
 * field a property lives in.
 */
export class SceneObject {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  private label: string;
  private weight = 0;
  private price = 0;
  private capacityGallons = 0;
  private fillGallons = 0;
  private loadWatts = 0;
  private loadHoursPerDay = 0;
  private loadIsAc = false;
  private batteryAmpHours = 0;
  private solarWatts = 0;
  private inverterWatts = 0;
  private tankRole = 'none';
  private fixtureFlowGpm = 0;
  private fixtureMinutesPerDay = 0;
  private drainsToGrey = true;
  private pumpGpm = 0;
  private notes = '';
  private material = 'birch-ply';
  private locked = false;
  private layerId = '';
  private groupId = '';
  private profilePoints: ProfilePoint[] = [];
  private ownsGeometry = false;

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

    const { geometry, owned } = GEOMETRY.create(kind);
    this.ownsGeometry = owned;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.objectId = id;
  }

  /** True when this kind carries an editable polygon profile. */
  get hasProfile(): boolean {
    return KIND_INFO[this.kind].hasProfile;
  }

  /** The polygon profile, empty for kinds that do not use one. */
  get profile(): readonly ProfilePoint[] {
    return this.profilePoints;
  }

  /**
   * Replaces the profile and rebuilds the geometry.
   *
   * The object's width and depth are set from the profile's own bounds, so a
   * profile typed in inches produces an object of exactly that size rather than
   * one stretched to whatever scale it happened to have. Height is preserved,
   * since it is not part of the profile.
   *
   * @returns False when the polygon is degenerate, leaving the object unchanged.
   */
  setProfile(points: readonly ProfilePoint[]): boolean {
    if (!this.hasProfile || !isProfileUsable(points)) return false;

    this.profilePoints = points.map(([x, z]) => [x, z] as ProfilePoint);
    this.rebuildGeometry();

    const bounds = profileBounds(this.profilePoints);
    this.mesh.scale.x = Math.max(MIN_DIMENSION, bounds.width);
    this.mesh.scale.z = Math.max(MIN_DIMENSION, bounds.depth);
    this.mesh.updateMatrixWorld(true);
    return true;
  }

  /** Fresh edge geometry matching this object, for the selection outline. */
  createEdges(): { geometry: THREE.BufferGeometry; owned: boolean } {
    return GEOMETRY.createEdges(this.kind, this.profilePoints);
  }

  /** Display name. Kept in sync with the mesh name for debugging. */
  get name(): string {
    return this.label;
  }

  /**
   * True when the object's own lock flag is set.
   *
   * This is the object's individual state. Effective lock also depends on its
   * layer, which only {@link StructureRegistry} knows about — callers deciding
   * whether a transform is permitted should ask the registry, not this.
   */
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
      capacityGallons: this.capacityGallons,
      fillGallons: this.fillGallons,
      loadWatts: this.loadWatts,
      loadHoursPerDay: this.loadHoursPerDay,
      loadIsAc: this.loadIsAc,
      batteryAmpHours: this.batteryAmpHours,
      solarWatts: this.solarWatts,
      inverterWatts: this.inverterWatts,
      tankRole: this.tankRole,
      fixtureFlowGpm: this.fixtureFlowGpm,
      fixtureMinutesPerDay: this.fixtureMinutesPerDay,
      drainsToGrey: this.drainsToGrey,
      pumpGpm: this.pumpGpm,
      notes: this.notes,
      material: this.material,
      locked: this.locked,
      visible: this.mesh.visible,
      layerId: this.layerId,
      groupId: this.groupId,
      ...(this.profilePoints.length > 0
        ? { profile: this.profilePoints.map(([x, z]) => [x, z] as [number, number]) }
        : {}),
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
    this.capacityGallons = data.capacityGallons ?? 0;
    this.fillGallons = Math.min(data.fillGallons ?? 0, this.capacityGallons);
    this.loadWatts = data.loadWatts ?? 0;
    this.loadHoursPerDay = data.loadHoursPerDay ?? 0;
    this.loadIsAc = data.loadIsAc ?? false;
    this.batteryAmpHours = data.batteryAmpHours ?? 0;
    this.solarWatts = data.solarWatts ?? 0;
    this.inverterWatts = data.inverterWatts ?? 0;
    this.tankRole = data.tankRole ?? 'none';
    this.fixtureFlowGpm = data.fixtureFlowGpm ?? 0;
    this.fixtureMinutesPerDay = data.fixtureMinutesPerDay ?? 0;
    this.drainsToGrey = data.drainsToGrey ?? true;
    this.pumpGpm = data.pumpGpm ?? 0;
    this.notes = data.notes;
    this.material = data.material ?? 'birch-ply';
    this.locked = data.locked;
    this.layerId = data.layerId ?? '';
    this.groupId = data.groupId ?? '';

    if (this.hasProfile && data.profile && isProfileUsable(data.profile)) {
      this.profilePoints = data.profile.map(([x, z]) => [x, z] as ProfilePoint);
      this.rebuildGeometry();
      // Scale is restored from the saved dimensions afterwards, so a profile
      // the user stretched keeps the size they left it at.
      this.mesh.scale.fromArray(data.dimensions);
    }

    this.mesh.updateMatrixWorld(true);
  }

  /**
   * Frees this object's resources.
   *
   * Geometry is disposed only when this object owns it. Shared kind geometry
   * outlives every object using it and must never be freed here.
   */
  dispose(): void {
    this.mesh.material.dispose();
    if (this.ownsGeometry) this.mesh.geometry.dispose();
  }

  /** Swaps in geometry for the current profile, freeing any it replaces. */
  private rebuildGeometry(): void {
    const { geometry, owned } = GEOMETRY.create(this.kind, this.profilePoints);
    if (this.ownsGeometry) this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.ownsGeometry = owned;
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
      case 'capacityGallons':
        return this.capacityGallons;
      case 'fillGallons':
        return this.fillGallons;
      case 'loadWatts':
        return this.loadWatts;
      case 'loadHoursPerDay':
        return this.loadHoursPerDay;
      case 'loadIsAc':
        return this.loadIsAc;
      case 'batteryAmpHours':
        return this.batteryAmpHours;
      case 'solarWatts':
        return this.solarWatts;
      case 'inverterWatts':
        return this.inverterWatts;
      case 'tankRole':
        return this.tankRole;
      case 'fixtureFlowGpm':
        return this.fixtureFlowGpm;
      case 'fixtureMinutesPerDay':
        return this.fixtureMinutesPerDay;
      case 'drainsToGrey':
        return this.drainsToGrey;
      case 'pumpGpm':
        return this.pumpGpm;
      case 'notes':
        return this.notes;
      case 'material':
        return this.material;
      case 'locked':
        return this.locked;
      case 'visible':
        return this.mesh.visible;
      case 'layerId':
        return this.layerId;
      case 'groupId':
        return this.groupId;
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
      case 'capacityGallons':
        this.capacityGallons = Math.max(0, Number(value));
        // Shrinking a tank must not leave more fluid in it than it can hold.
        this.fillGallons = Math.min(this.fillGallons, this.capacityGallons);
        break;
      case 'fillGallons':
        this.fillGallons = Math.min(Math.max(0, Number(value)), this.capacityGallons);
        break;
      case 'loadWatts':
        this.loadWatts = Math.max(0, Number(value));
        break;
      case 'loadHoursPerDay':
        this.loadHoursPerDay = Math.min(24, Math.max(0, Number(value)));
        break;
      case 'loadIsAc':
        this.loadIsAc = Boolean(value);
        break;
      case 'batteryAmpHours':
        this.batteryAmpHours = Math.max(0, Number(value));
        break;
      case 'solarWatts':
        this.solarWatts = Math.max(0, Number(value));
        break;
      case 'inverterWatts':
        this.inverterWatts = Math.max(0, Number(value));
        break;
      case 'tankRole':
        this.tankRole = String(value);
        break;
      case 'fixtureFlowGpm':
        this.fixtureFlowGpm = Math.max(0, Number(value));
        break;
      case 'fixtureMinutesPerDay':
        this.fixtureMinutesPerDay = Math.max(0, Number(value));
        break;
      case 'drainsToGrey':
        this.drainsToGrey = Boolean(value);
        break;
      case 'pumpGpm':
        this.pumpGpm = Math.max(0, Number(value));
        break;
      case 'notes':
        this.notes = String(value);
        break;
      case 'material':
        this.material = String(value);
        break;
      case 'locked':
        this.locked = Boolean(value);
        break;
      case 'visible':
        this.mesh.visible = Boolean(value);
        break;
      case 'layerId':
        this.layerId = String(value);
        break;
      case 'groupId':
        this.groupId = String(value);
        break;
    }

    this.mesh.updateMatrixWorld(true);
  }
}
