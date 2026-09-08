import type { SchemaEntry, AssetField } from "../../schema/types";

/** Relationships verified in both installed model corpora. Paths distinguish
 * file-valued type from state/mesh identifiers and nested names. */
const fields: Record<string, AssetField> = {
  "pdxmesh/name": { doc: "Declares the mesh name referenced by entity.pdxmesh." },
  "entity/name": { doc: "Declares an entity name." },
  "pdxmesh/file": { doc: "Mesh file, relative to this asset or the content root.", files: [".mesh"] },
  "entity/pdxmesh": {
    doc: "References a pdxmesh declaration, not a mesh filename.",
    target: { block: "pdxmesh" },
  },
  "entity/default_state": {
    doc: "State name declared in this entity.",
    target: { owner: "entity", block: "state" },
  },
  "entity/state/next_state": {
    doc: "Next state declared in this entity.",
    target: { owner: "entity", block: "state" },
  },
  "entity/state/animation": {
    doc: "Animation ID declared by the entity's mesh.",
    target: { owner: "pdxmesh", via: "pdxmesh", block: "animation", key: "id" },
  },
  "entity/attribute/blend_shape": {
    doc: "Blend-shape ID declared by the entity's mesh.",
    target: { owner: "pdxmesh", via: "pdxmesh", block: "blend_shape", key: "id" },
  },
  "entity/attribute/additive_animation": {
    doc: "Additive-animation ID declared by the entity's mesh.",
    target: { owner: "pdxmesh", via: "pdxmesh", block: "additive_animation", key: "id" },
  },
  "entity/attach/*": {
    doc: "Entity attached at the locator named by this key.",
    target: { block: "entity" },
  },
};
for (const owner of ["pdxmesh", "entity"]) {
  const context = `${owner}/meshsettings`;
  fields[`${context}/name`] = {
    doc: "Shape name inside the binary mesh. This is not a global script definition.",
  };
  fields[`${context}/shader`] = {
    doc: "Effect declared in the sibling shader_file.",
    shaderFile: "shader_file",
  };
  fields[`${context}/shader_file`] = {
    doc: "Shader source, including the engine's jomini layer.",
    files: [".shader"],
  };
  for (const key of ["texture_diffuse", "texture_normal", "texture_specular"]) {
    fields[`${context}/${key}`] = { doc: "Texture file used by this mesh material.", files: [".dds"] };
  }
  fields[`${context}/texture/file`] = { doc: "Texture file for this material slot.", files: [".dds"] };
}
for (const block of ["animation", "additive_animation", "blend_shape"]) {
  fields[`pdxmesh/${block}/id`] = { doc: `Declares a ${block} ID local to this mesh.` };
  fields[`pdxmesh/${block}/type`] = {
    doc: `Binary file for this ${block}.`,
    files: [block === "blend_shape" ? ".mesh" : ".anim"],
  };
}
for (const block of ["event", "start_event"]) {
  fields[`entity/state/${block}/entity`] = {
    doc: "Entity spawned by this state event.",
    target: { block: "entity" },
  };
}

/** Verified in the CK3 and Victoria 3 gfx/models .asset corpora (2026-09-08).
 * Names come from the files; binary meshes, animations and textures are not scanned. */
export const ASSET_SCHEMA: SchemaEntry = {
  path: "gfx",
  ext: ".asset",
  kind: "asset",
  extraction: "named-block",
  assetFields: fields,
  assetEnginePaths: ["../jomini"],
  referenceKeys: ["entity", "pdxmesh"],
  fileFields: {
    file: [".mesh", ".anim"],
    type: [".mesh", ".anim"],
    texture_diffuse: [".dds"],
    texture_normal: [".dds"],
    texture_specular: [".dds"],
    shader_file: [".shader"],
  },
  completable: false,
};
