// Uniforms: MVP matrix (model-view-projection)
struct Uniforms {
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

// Vertex output: clip-space position + RGBA color
struct VOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn main_vs(@location(0) p: vec3f) -> VOut {
  var o: VOut;

  // Transform model-space position to clip space
  o.position = u.mvp * vec4f(p, 1.0);

  // Map position components from [-1,1] to [0,1] for a simple RGB gradient
  let rgb = 0.5 * p + vec3f(0.5, 0.5, 0.5);
  o.color = vec4f(rgb, 1.0);

  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  // Output interpolated color
  return c;
}
