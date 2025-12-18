// Uniforms: MVP matrix (model-view-projection)
struct Uniforms {
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

// Vertex shader output: clip-space position + color
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
};

@vertex
fn main_vs(@location(0) p: vec3f) -> VSOut {
  var o: VSOut;

  // Transform position to clip space
  o.pos = u.mvp * vec4f(p, 1.0);

  // Constant per-vertex color (blue)
  o.col = vec4f(0.0, 0.0, 1.0, 1.0);

  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
