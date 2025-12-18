// Uniforms: MVP matrix
struct Uniforms {
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

// Vertex output: clip-space position + vertex color (Gouraud shading)
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
};

@vertex
fn main_vs(@location(0) p: vec3f) -> VSOut {
  var o: VSOut;

  // Transform to clip space
  o.pos = u.mvp * vec4f(p, 1.0);

  // Unit-sphere normal (position normalized)
  let n = normalize(p);

  // Directional light coming from +Z (l_e = (0,0,-1) => incoming l = (0,0,1))
  let l = vec3f(0.0, 0.0, 1.0);

  // White light intensity
  let Le = vec3f(1.0, 1.0, 1.0);

  // Diffuse reflectance (base color)
  let kd = vec3f(0.20, 0.55, 1.00);

  // Lambert diffuse term
  let ndotl = max(dot(n, l), 0.0);
  let Ld = kd * Le * ndotl;

  // Gouraud shading: compute color per-vertex
  o.col = vec4f(Ld, 1.0);
  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  // Interpolated vertex color
  return c;
}
