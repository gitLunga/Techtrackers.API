using Microsoft.EntityFrameworkCore;
using System.Text;
using TechTrackers.Data;

namespace TechTrackers.Service.Services
{
    public class UserLogService
    {
        private readonly TechTrackersDbContext _dbContext;

        public UserLogService(TechTrackersDbContext dbContext)
        {
            _dbContext = dbContext ?? throw new ArgumentNullException(nameof(dbContext));
        }

        //Method for user login

        public async Task<UserWithRolesDto> Login(string email, string password)
        {
            var user = await _dbContext.Users
                .Include(u => u.UserRoles)
                .ThenInclude(ur => ur.Role)
                .Include(u => u.Department)
                .FirstOrDefaultAsync(u => u.EmailAddress == email && u.PasswordHash == password);
            if (user == null)
            {
                throw new UnauthorizedAccessException("Invalid email or password.");
            }

            else
            {
                Console.WriteLine($"User found: {user.Initials} {user.Surname}");
                Console.WriteLine($"Roles count: {user.UserRoles.Count}");
            }

            //Extract roles from UserRoles
            var roles = user.UserRoles.Select(ur => ur.Role.RoleName).ToList();
            Console.WriteLine($"Roles found for user: {string.Join(", ", roles)}");

            return new UserWithRolesDto
            {
                UserId = user.UserId,
                Name = $"{user.Initials} {user.Surname}",
                Email = user.EmailAddress,
                Department = user.Department?.DepartmentName,
                Roles = roles // return the list of roles the user have
            };
        }


    }

    public class UserWithRolesDto
    {
        public int UserId { get; set; }
        public string? Name { get; set; }

        public string? Email { get; set; }

        public string? Department { get; set; }

        public List<string>? Roles { get; set; }
    }
}
