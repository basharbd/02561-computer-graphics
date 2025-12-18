// Uniform block: theta stored in a vec4 for alignment (use .x as the angle)
struct Uniforms {
  theta : vec4f,  // x = theta (radians)
};

@group(0) @binding(0) var<uniform> U : Uniforms;

@vertex
fn main_vs(@location(0) inPos : vec2f) -> @builtin(position) vec4f {
  // Read rotation angle and precompute cos/sin
  let a = U.theta.x;
  let c = cos(a);
  let s = sin(a);

  // 2D rotation around the origin
  let x = inPos.x * c - inPos.y * s;
  let y = inPos.x * s + inPos.y * c;

  // Output clip-space position
  return vec4f(x, y, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
  // Solid white output
  return vec4f(1.0, 1.0, 1.0, 1.0); // white quad
}
