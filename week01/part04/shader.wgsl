struct Uniforms {
  theta : vec4f,  // x = theta
};

@group(0) @binding(0) var<uniform> U : Uniforms;

@vertex
fn main_vs(@location(0) inPos : vec2f) -> @builtin(position) vec4f {
  let a = U.theta.x;
  let c = cos(a);
  let s = sin(a);

  let x = inPos.x * c - inPos.y * s;
  let y = inPos.x * s + inPos.y * c;

  return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 1.0); // white quad
}
