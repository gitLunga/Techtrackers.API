using Microsoft.AspNetCore.Mvc;

namespace TechTrackers.API.Controllers
{
    public class CollaControllerB : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
