struct Uniforms {
  mvp: mat4x4f,
  eye: vec4f,     // xyz = camera position, w unused
  params: vec4f,  // x=Le, y=La, z=kd, w=ks
  shin: vec4f,    // x=s, rest unused
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

  // Clip-space position
  o.pos = u.mvp * vec4f(p, 1.0);

  // Unit-sphere normal (same as position)
  let n = normalize(p);

  // Directional light: l_e = (0,0,-1) => incoming direction omega_i = -l_e
  let omega_i = vec3f(0.0, 0.0, 1.0);

  // View direction (from point to eye)
  let w_o = normalize(u.eye.xyz - p);

  // Slider scalars (white lights)
  let Le = vec3f(1.0) * u.params.x;
  let La = vec3f(1.0) * u.params.y;
  let kd = u.params.z;
  let ks = u.params.w;
  let s  = max(u.shin.x, 1.0);

  // Fixed material tints (kept constant)
  let diffuseTint  = vec3f(0.85, 0.25, 0.20);
  let specularTint = vec3f(1.0, 1.0, 1.0);

  // Per assignment: ka = kd
  let k_d = diffuseTint * kd;
  let k_a = k_d;
  let k_s = specularTint * ks;

  // Ambient
  let L_ra = k_a * La;

  // Diffuse (Lambert)
  let ndotl = max(dot(n, omega_i), 0.0);
  let L_rd = k_d * Le * ndotl;

  // Specular (Phong), only if lit
  var L_rs = vec3f(0.0);
  if (ndotl > 0.0) {
    let w_r = reflect(-omega_i, n);
    let spec = pow(max(dot(w_r, w_o), 0.0), s);
    L_rs = k_s * Le * spec;
  }

  o.col = vec4f(L_ra + L_rd + L_rs, 1.0);
  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  return c;
}
