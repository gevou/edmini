#!/usr/bin/env python3
"""
Build a SYNTHETIC stand-in for the CAM++ speaker model (edmini-xz9 validation).

It is NOT a trained speaker model — it only reproduces CAM++'s ONNX I/O contract so we can validate
the TS-VAD plumbing (fbank -> ONNX Runtime -> cosine) end-to-end in CI where the real ~28MB weights
aren't reachable (HF/ModelScope are network-blocked here). The graph deterministically maps a window's
mean log-mel spectrum to a 192-d embedding, so:
  - identical audio  -> identical embedding (cosine 1.0)
  - different spectra -> different embeddings (cosine < 1.0)
which is exactly what's needed to prove the wiring; real speaker-discrimination quality is validated
by pointing the same harness at the real model locally.

Contract (matches wespeaker/3D-Speaker CAM++ exports):
  input  "feats" : float32 [1, T, 80]   (T dynamic)
  output "embs"  : float32 [1, 192]
"""
import numpy as np
from onnx import TensorProto, helper, numpy_helper, save

DIM = 192
MELS = 80

rng = np.random.default_rng(42)
# Fixed projection so embeddings are deterministic across runs.
W = (rng.standard_normal((MELS, DIM)) / np.sqrt(MELS)).astype(np.float32)

nodes = [
    # mean over the time axis (axis=1) -> [1, 80]
    helper.make_node("ReduceMean", ["feats"], ["pooled"], axes=[1], keepdims=0),
    # project to 192-d and add a mild nonlinearity
    helper.make_node("MatMul", ["pooled", "W"], ["proj"]),
    helper.make_node("Tanh", ["proj"], ["embs"]),
]

graph = helper.make_graph(
    nodes,
    "synthetic_campplus",
    [helper.make_tensor_value_info("feats", TensorProto.FLOAT, [1, "T", MELS])],
    [helper.make_tensor_value_info("embs", TensorProto.FLOAT, [1, DIM])],
    [numpy_helper.from_array(W, name="W")],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
model.ir_version = 9  # match onnxruntime-node 1.27 support

out = "scripts/fixtures/synthetic_campplus.onnx"
import os
os.makedirs("scripts/fixtures", exist_ok=True)
save(model, out)
print(f"wrote {out}  (input feats[1,T,{MELS}] -> output embs[1,{DIM}])")
