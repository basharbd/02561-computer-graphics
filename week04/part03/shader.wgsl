struct Uniforms {
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
};

@vertex
fn main_vs(@location(0) p: vec3f) -> VSOut {
  var o: VSOut;

  // Position to clip space
  o.pos = u.mvp * vec4f(p, 1.0);

  // True normal for a unit sphere centered at origin
  let n = normalize(p);

  // Given (light emission direction) l_e = (0,0,-1)
  // Incoming light direction: l = -l_e = (0,0,1)
  let l = vec3f(0.0, 0.0, 1.0);

  // White directional light: Le = (1,1,1)
  let Le = vec3f(1.0, 1.0, 1.0);

  // Sphere "color" as diffuse coefficient kd (choose a constant color)
  let kd = vec3f(0.20, 0.55, 1.00);

  // Diffuse (Lambert)
  let ndotl = max(dot(n, l), 0.0);
  let Ld = kd * Le * ndotl;

  // Gouraud: compute color per-vertex
  o.col = vec4f(Ld, 1.0);
  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  return c;
}
