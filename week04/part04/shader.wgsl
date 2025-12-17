struct Uniforms {
  mvp: mat4x4f,
  eye: vec4f,     // xyz = camera position (world/object), w unused
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

  // Transform position
  o.pos = u.mvp * vec4f(p, 1.0);

  // True normal (unit sphere => normal = position)
  let n = normalize(p);

  // Directional light:
  // Assignment gives direction (0,0,-1). Like Part 3: omega_i = -l_e
  let omega_i = vec3f(0.0, 0.0, 1.0);

  // Camera direction
  let w_o = normalize(u.eye.xyz - p);

  // Scalars from sliders
  let Le = vec3f(1.0) * u.params.x; // emitted radiance (white)
  let La = vec3f(1.0) * u.params.y; // ambient radiance (white)
  let kd = u.params.z;
  let ks = u.params.w;
  let s  = max(u.shin.x, 1.0);

  // Choose material colors (fixed, as requested)
  let diffuseColor  = vec3f(0.85, 0.25, 0.20); // diffuse tint
  let specularColor = vec3f(1.0, 1.0, 1.0);   // specular tint (white)

  // ka = kd (per assignment)
  let k_d = diffuseColor * kd;
  let k_a = k_d;
  let k_s = specularColor * ks;

  // Diffuse
  let ndotl = max(dot(n, omega_i), 0.0);
  let L_rd = k_d * Le * ndotl;

  // Ambient
  let L_ra = k_a * La;

  // Specular (Phong)
  // Li = Le (no shadows / no attenuation)
  var L_rs = vec3f(0.0);
  if (ndotl > 0.0) {
    let w_r = reflect(-omega_i, n);
    let spec = pow(max(dot(w_r, w_o), 0.0), s);
    L_rs = k_s * Le * spec;
  }

  let L_o = L_ra + L_rd + L_rs;
  o.col = vec4f(L_o, 1.0);
  return o;
}

@fragment
fn main_fs(@location(0) c: vec4f) -> @location(0) vec4f {
  return c;
}
