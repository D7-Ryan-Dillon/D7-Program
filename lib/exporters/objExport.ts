import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";

const loader = new GLTFLoader();
const exporter = new OBJExporter();

/** Loads a tile's GLB fresh (independent of any live viewport) and serializes it to OBJ text. */
export async function tileToObjText(glbUrl: string, visibility?: { foam: boolean; void: boolean }): Promise<string> {
  const gltf = await loader.loadAsync(glbUrl);
  const scene = gltf.scene.clone(true);
  if (visibility) {
    const foam = scene.getObjectByName("foam");
    const voidMesh = scene.getObjectByName("void");
    if (foam) foam.visible = visibility.foam;
    if (voidMesh) voidMesh.visible = visibility.void;
  }
  return exporter.parse(scene);
}

/** Serializes several already-transformed objects (an Arrange composition) into one OBJ text. */
export function groupToObjText(group: THREE.Object3D): string {
  return exporter.parse(group);
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
