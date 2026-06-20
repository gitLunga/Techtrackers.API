using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using TechTrackers.Data.Model.dto;
using TechTrackers.Service;
namespace TechTrackers.API.Controllers
{
    [ApiController]
    [Route("api/[controller]/[action]")]
    [EnableCors("corspolicy")]
    public class AccountController : ControllerBase
    {
        private readonly IUserService _userService;
        private readonly IEmailService _emailService;
        private readonly IOTPService _otpService;


        public AccountController(IUserService userService, IEmailService emailService, IOTPService otpService)
        {
            _userService = userService;
            _emailService = emailService;
            _otpService = otpService;
        }


        [HttpPost("request-otp")]
        public async Task<IActionResult> RequestOtp([FromBody] RequestOtpDto dto)
        {
            try
            {
                var user = await _userService.GetUserByEmail(dto.Email);
                if (user == null)
                {
                    return NotFound("User not found");
                }

                // Generate OTP and send via email
                var otp = _otpService.GenerateOtp();
                await _otpService.SaveOtp(user.EmailAddress, otp); // Save OTP for later validation
                await _emailService.SendOtpEmail(user.EmailAddress, otp);

                return Ok("OTP sent to your email.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in RequestOtp: {ex.Message}");
                return StatusCode(500, "An internal server error occured");

            }
        }

        // 2. Verify OTP only (optional if you want a separate verify step)
        [HttpPost("verify-otp")]
        public async Task<IActionResult> VerifyOtp([FromBody] VerifyOtpDto dto)
        {
            var isOtpValid = await _otpService.ValidateOtp(dto.Email, dto.Otp);
            if (!isOtpValid)
                return BadRequest("Invalid or expired OTP");

            return Ok("OTP is valid. Proceed to the next step..");
        }

        // This is a step 2: Verify OTP and Reset Password
        [HttpPost("reset-password")]
        public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordDto dto)
        {
            Console.WriteLine($"Received Email: {dto.Email}, OTP: {dto.Otp}");

            // Retrieve and log stored OTP

            // Validate OTP
            var isOtpValid = await _otpService.ValidateOtp(dto.Email, dto.Otp);
            if (!isOtpValid)
            {
                Console.WriteLine("Invalid OTP entered.");
                return BadRequest("Invalid OTP");
            }

            // Proceed to reset the password if OTP is valid
            var user = await _userService.GetUserByEmail(dto.Email);
            if (user == null)
            {
                return NotFound("User not found");
            }

            await _userService.ResetPassword(user, dto.NewPassword);
            await _otpService.InvalidateOtp(dto.Email, dto.Otp);
            return Ok("Password has been reset successfully.");

        }
    }
}
