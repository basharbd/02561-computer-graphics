struct Uniforms {
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn main_vs(@location(0) p: vec3f) -> VOut {
  var o: VOut;

  // clip-space position
  o.position = u.mvp * vec4f(p, 1.0);

  // color from vertex position: c = 0.5*p + 0.5  (xyz only)
  let rgb = 0.5 * p + vec3f(0.5, 0.5, 0.5);
  o.color = vec4f(rgb, 1.0);

  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  return c;
}
