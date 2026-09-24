import type { Scene } from "./scene";
import { indexOfSelection, outermost, selectionAt, type Selection } from "./selection";

/** Owns persistent widget identities and their indices in the current scene. */
export class SelectionController {
  private primarySelectionIdentity: Selection | null = null;
  private secondarySelectionIdentities: Selection[] = [];
  private primaryIndex: number | null = null;
  private secondaryIndices: number[] = [];

  get primarySceneIndex(): number | null {
    return this.primaryIndex;
  }

  get secondarySceneIndices(): readonly number[] {
    return this.secondaryIndices;
  }

  /** Primary last, as required by Shift+click promotion and structural batches. */
  sceneIndices(): number[] {
    return this.primaryIndex === null
      ? [...this.secondaryIndices]
      : [...this.secondaryIndices, this.primaryIndex];
  }

  select(scene: Scene, index: number | null, keepSecondary = false): void {
    if (!keepSecondary) {
      this.secondaryIndices = [];
      this.secondarySelectionIdentities = [];
    }
    this.primarySelectionIdentity = index === null ? null : selectionAt(scene, index);
    this.primaryIndex = this.primarySelectionIdentity === null ? null : index;
  }

  selectMany(scene: Scene, members: readonly number[]): void {
    const indices = outermost(scene, members).filter((index) => !!scene.items[index]);
    this.secondaryIndices = indices.slice(0, -1);
    this.secondarySelectionIdentities = this.secondaryIndices.map((index) => selectionAt(scene, index)!);
    this.select(scene, indices.length === 0 ? null : indices[indices.length - 1], true);
  }

  /** Resolve all members together before any renderer reads the new scene. */
  restore(scene: Scene): void {
    const primarySceneIndex = this.primarySelectionIdentity
      ? indexOfSelection(scene, this.primarySelectionIdentity)
      : null;
    const secondarySceneIndices = this.secondarySelectionIdentities
      .map((identity) => indexOfSelection(scene, identity))
      .filter((index): index is number => index !== null && index !== primarySceneIndex);
    this.secondaryIndices = [...new Set(secondarySceneIndices)];
    this.secondarySelectionIdentities = this.secondaryIndices.map((index) => selectionAt(scene, index)!);
    this.select(scene, primarySceneIndex, true);
  }

  /** A confirmed authored rename identifies the widget without guessing on relayout. */
  renamePrimary(name: string): void {
    if (this.primarySelectionIdentity) {
      this.primarySelectionIdentity = { ...this.primarySelectionIdentity, name };
    }
  }
}
