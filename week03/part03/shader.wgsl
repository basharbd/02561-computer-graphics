// Uniforms: 3 MVP matrices (one for each instance)
struct Uniforms {
  mvp : array<mat4x4f, 3>,
};

@group(0) @binding(0)
var<uniform> u : Uniforms;

// Vertex shader output: clip-space position + interpolated color
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) col : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos   : vec4f,                 // input position (already vec4)
  @location(1) inColor : vec4f,                 // per-vertex RGBA color
  @builtin(instance_index) inst : u32           // instance id (0..2)
) -> VSOut {
  var o : VSOut;

  // Transform to clip space using the instance's MVP
  o.pos = u.mvp[inst] * inPos;

  // Pass color through (will interpolate)
  o.col = inColor;
  return o;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
